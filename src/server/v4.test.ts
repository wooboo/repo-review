import { test, expect } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { makeApplication } from "./application";
import { resolveJevKey } from "./jev-key";
import { callTool } from "../mcp/server";
import { executeCloneDeletion } from "../collector/delete-clone";
import type { WorkerAction } from "../collector/action-worker";
import { git, run } from "../collector/git";
import { collectRepo } from "../collector/analyze";
import { normalizePullRequest } from "./pull-requests";
import deletedHead from "./fixtures/forgejo-deleted-head.json";
const safe = { t3: false, cwds: [] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "review-v4-")),
    repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "f"), "initial");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  return {
    root,
    repo,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}
function action(root: string, repo: string): WorkerAction {
  return {
    id: crypto.randomUUID(),
    kind: "delete-clone",
    target: { host: "local", repo },
    branchId: null,
    repoKey: "example.test/team/repo",
    status: "planned",
    reason: "",
    restore: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    sha: "",
    base: "",
    baseSha: "",
    remoteUrl: "",
    cloneDeletion: {
      cloneId: "local:" + repo,
      name: "repo",
      roots: [root],
      worktreeDir: join(root, "agents"),
      archiveDir: join(root, "archives"),
    },
  };
}
test("Jev settings are redacted on API/MCP, round trip preserves, null clears, resolver precedence", async () => {
  const app = makeApplication(":memory:");
  const old = process.env.TYPESAFE_API_KEY;
  try {
    process.env.TYPESAFE_API_KEY = "env-test-key";
    await app.updateSettings({
      ...app.settings(),
      jev: {
        apiKey: "stored-test-key",
        apiKeyCommand: "printf command-test-key",
      },
    });
    const view = await app.settingsView();
    expect(view.jev).toEqual({
      apiKeySet: true,
      apiKeyCommand: "printf command-test-key",
      source: "settings",
    });
    expect(
      JSON.stringify(await callTool(app, "get_settings", {})),
    ).not.toContain("stored-test-key");
    await app.updateSettings({ ...view, hosts: view.hosts });
    expect((await resolveJevKey(app.settings())).key).toBe("stored-test-key");
    await app.updateSettings({ ...view, jev: { apiKey: null } });
    expect((await resolveJevKey(app.settings())).key).toBe("command-test-key");
    await app.updateSettings({ ...view, jev: { apiKeyCommand: null } });
    expect((await resolveJevKey(app.settings())).source).toBe("env");
    delete process.env.TYPESAFE_API_KEY;
    expect((await resolveJevKey(app.settings())).source).toBe("none");
  } finally {
    if (old === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = old;
    await app.close();
  }
});
test("clone plan counts, archive restores branches/stash and dirty files, then removes clone", () => {
  const f = fixture();
  try {
    git(f.repo, "checkout", "-b", "feature");
    writeFileSync(join(f.repo, "f"), "feature");
    git(f.repo, "commit", "-am", "feature");
    writeFileSync(join(f.repo, "f"), "stash");
    git(f.repo, "stash", "push", "-m", "saved");
    writeFileSync(join(f.repo, "f"), "dirty");
    writeFileSync(join(f.repo, "new"), "untracked");
    writeFileSync(
      join(f.repo, ".git/info/exclude"),
      ".env\nnode_modules/\nlarge\n",
    );
    writeFileSync(join(f.repo, ".env"), "fixture value");
    mkdirSync(join(f.repo, "node_modules"));
    writeFileSync(join(f.repo, "node_modules", "dep"), "dep");
    writeFileSync(join(f.repo, "large"), Buffer.alloc(6 * 1024 * 1024));
    const planned = executeCloneDeletion(action(f.root, f.repo), false, safe);
    expect(planned.status).toBe("planned");
    const s = planned.cloneDeletion!.summary!;
    expect(s.branches).toBe(2);
    expect(s.stashes).toBe(1);
    expect(s.dirtyFiles).toBe(2);
    expect(s.unpushedBranches.map((b) => b.name)).toContain("feature");
    expect(s.ignoredKept.files).toBe(1);
    expect(s.ignoredSkipped.files).toBe(2);
    const done = executeCloneDeletion(planned, true, safe);
    expect(done.status).toBe("done");
    expect(existsSync(f.repo)).toBe(false);
    const archive = done.cloneDeletion!.archivePath!;
    const restored = join(f.root, "restored");
    expect(
      run("git", ["clone", join(archive, "repo.bundle"), restored]).code,
    ).toBe(0);
    expect(git(restored, "show-ref", "refs/remotes/origin/feature").code).toBe(
      0,
    );
    expect(
      run("git", ["bundle", "list-heads", join(archive, "repo.bundle")]).out,
    ).toContain("refs/stash");
    const tar = run("tar", ["-tzf", join(archive, "worktrees/0.tar.gz")]);
    expect(tar.code).toBe(0);
    expect(tar.out).toContain(".env");
    expect(tar.out).toContain("new");
    expect(tar.out).not.toContain("node_modules");
  } finally {
    f.clean();
  }
});
test("fingerprint and roots block before removal", () => {
  const f = fixture();
  try {
    const a = action(f.root, f.repo),
      planned = executeCloneDeletion(a, false, safe);
    writeFileSync(join(f.repo, "f"), "moved");
    expect(executeCloneDeletion(planned, true, safe).reason).toContain(
      "fingerprint",
    );
    expect(
      executeCloneDeletion(
        {
          ...a,
          cloneDeletion: {
            ...a.cloneDeletion!,
            roots: [join(f.root, "elsewhere")],
          },
        },
        false,
        safe,
      ).status,
    ).toBe("blocked");
    expect(existsSync(f.repo)).toBe(true);
  } finally {
    f.clean();
  }
});
test("partial clone purge retains PRs, final purge removes references across every table and preserves audit", async () => {
  const f = fixture(),
    path = join(f.root, "test.db"),
    app = makeApplication(path);
  try {
    const clone = collectRepo(join(f.repo, ".git"), f.repo, false);
    app.db.replaceHost("local", [
      clone,
      { ...clone, path: join(f.root, "second") },
    ]);
    const key = clone.key;
    app.db.put("pull_request", "test", { repo: key, head: "feature" });
    app.db.putCommits("test", [
      { sha: "abc", subject: "test", author: "Test", at: "" },
    ]);
    app.db.put("classification", "test", { id: key + "#feature", value: {} });
    app.db.put("settings", "pr-sync:" + key, "watermark");
    app.db.put("settings", "pr-commits:" + key + "!1:sha", []);
    app.db.put("action", "test", {
      repoKey: key,
      kind: "delete-clone",
      status: "done",
    });
    const archive = {
      host: "local",
      path: f.repo,
      archivePath: join(f.root, "archive"),
    };
    app.db.purgeClone(key, "local:" + f.repo, archive, clone.name);
    expect(app.db.get("pull_request", "test")).toBeDefined();
    app.db.purgeClone(
      key,
      "local:" + join(f.root, "second"),
      archive,
      clone.name,
    );
    expect(app.db.get("repository", key)).toBeUndefined();
    expect(app.db.get("action", "test")).toBeDefined();
    expect(app.listDeletedRepositories()).toHaveLength(1);
    const sql = new Database(path, { readonly: true });
    for (const { name } of sql
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string }[]) {
      if (["actions", "deleted_repositories"].includes(name)) continue;
      const cols = sql.query('PRAGMA table_info("' + name + '")').all() as {
        name: string;
      }[];
      for (const col of cols.filter((c) =>
        ["repo", "repository_id", "clone_id"].includes(c.name),
      )) {
        const rows = sql
          .query(
            'SELECT * FROM "' + name + '" WHERE "' + col.name + '" IN (?,?,?)',
          )
          .all(key, "repository:" + key, "clone:local:" + f.repo);
        expect(rows).toHaveLength(0);
      }
    }
    expect(sql.query("SELECT * FROM pull_request_commits").all()).toHaveLength(
      0,
    );
    sql.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(app.db.backup(join(f.root, "backups"))).mode & 0o777).toBe(
      0o600,
    );
  } finally {
    await app.close();
    f.clean();
  }
});
test("confirmation mismatch rejects the whole batch", async () => {
  const app = makeApplication(":memory:");
  try {
    const a = action("/tmp/example", "/tmp/example/repo");
    app.db.put("action", a.id, a);
    expect(app.applyActions([a.id], "wrong")).rejects.toMatchObject({
      _tag: "DeletionConfirmationError",
    });
    expect(app.db.get<WorkerAction>("action", a.id)?.status).toBe("planned");
  } finally {
    await app.close();
  }
});
test("Forgejo deleted head fixture falls back through metadata, message and history", () => {
  const pr = normalizePullRequest(
    "example.test/team/repo",
    "forgejo",
    deletedHead,
  );
  expect(pr.head).toBe("feature/saved");
  expect(
    normalizePullRequest(pr.repo, "forgejo", {
      ...deletedHead,
      head_branch: "feature/direct",
    }).head,
  ).toBe("feature/direct");
  expect(
    normalizePullRequest(
      pr.repo,
      "forgejo",
      { ...deletedHead, merge_commit_message: "" },
      false,
      [{ branch: "feature/history", sha: deletedHead.head.sha }],
    ).head,
  ).toBe("feature/history");
});
test("linked worktrees archive and process activity blocks", () => {
  const f = fixture();
  try {
    const linked = join(f.root, "linked");
    expect(git(f.repo, "worktree", "add", "-b", "linked", linked).code).toBe(0);
    writeFileSync(join(linked, "f"), "linked dirty");
    const a = action(f.root, f.repo);
    expect(
      executeCloneDeletion(a, false, { t3: false, cwds: [linked] }).reason,
    ).toContain("Process");
    const planned = executeCloneDeletion(a, false, safe);
    expect(planned.cloneDeletion?.summary?.linkedWorktrees[0]?.dirty).toBe(
      true,
    );
    const done = executeCloneDeletion(planned, true, safe);
    expect(done.status).toBe("done");
    expect(existsSync(linked)).toBe(false);
    expect(
      run("tar", [
        "-tzf",
        join(done.cloneDeletion!.archivePath!, "worktrees/1.tar.gz"),
      ]).out,
    ).toContain("f");
  } finally {
    f.clean();
  }
});
test("archive within checkout and moved refs are blocked", () => {
  const f = fixture();
  try {
    const a = action(f.root, f.repo);
    expect(
      executeCloneDeletion(
        {
          ...a,
          cloneDeletion: {
            ...a.cloneDeletion!,
            archiveDir: join(f.repo, "archives"),
          },
        },
        false,
        safe,
      ).reason,
    ).toContain("Archive");
    const planned = executeCloneDeletion(a, false, safe);
    git(f.repo, "branch", "new-ref");
    expect(executeCloneDeletion(planned, true, safe).reason).toContain(
      "fingerprint",
    );
    expect(existsSync(f.repo)).toBe(true);
  } finally {
    f.clean();
  }
});
