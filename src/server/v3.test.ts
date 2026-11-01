import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApplication } from "./application";
import { normalizePullRequest, mergeTrailers } from "./pull-requests";
import { rebuildProvenance, parseProvenance } from "./provenance";
import { analyzeBranch } from "../collector/analyze";
import { git } from "../collector/git";
import { execute } from "../collector/worker";
import { verdict, landedState } from "../domain/logic";
import type { Clone, Action } from "../domain/model";

function fixture() {
  const path = mkdtempSync(join(tmpdir(), "provenance-"));
  const g = (...args: string[]) => {
    const r = git(path, ...args);
    if (r.code) throw Error(r.error);
    return r.out.trim();
  };
  g("init", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.com");
  const commit = (content: string) => {
    writeFileSync(join(path, "file"), content);
    g("add", ".");
    g("commit", "-m", content);
    return g("rev-parse", "HEAD");
  };
  const root = commit("root");
  g("checkout", "-b", "topic");
  const first = commit("first");
  const head = commit("review fix");
  g("checkout", "main");
  commit("base conflict");
  // Conflict resolution makes the squashed patch differ from every PR patch.
  expect(git(path, "merge", "--squash", "topic").code).not.toBe(0);
  writeFileSync(join(path, "file"), "resolved with base and review fix");
  g("add", ".");
  g("commit", "-m", "Feature (#7)");
  const merge = g("rev-parse", "HEAD");
  const app = makeApplication(":memory:");
  app.updateSettings({
    ...app.settings(),
    hosts: [{ id: "local", kind: "local", roots: [path], enabled: true }],
  });
  const repo = "github.com/example/project";
  const snapshot = (): Clone => ({
    path,
    commonDir: join(path, ".git"),
    name: "project",
    key: repo,
    roots: [root],
    remotes: [],
    bases: ["main"],
    branches: ["main", "topic"].map((name) =>
      analyzeBranch(path, name, name, ["main"], "main", []),
    ),
    remoteBranches: [],
    worktrees: [],
    stashes: [],
    threads: [],
    about: "",
    errors: [],
  });
  const pr = {
    ...normalizePullRequest(repo, "github", {
      number: 7,
      title: "Feature",
      html_url: "https://github.com/example/project/pull/7",
      head: { ref: "topic", sha: head },
      base: { ref: "main" },
      state: "closed",
      merged_at: new Date().toISOString(),
      merge_commit_sha: merge,
    }),
    mergeMethod: "squash" as const,
    commitCount: 2,
  };
  app.db.put("pull_request", pr.id, pr);
  app.db.putCommits(
    pr.id,
    [first, head].map((sha) => ({
      sha,
      subject: "feature",
      author: "Test",
      at: new Date().toISOString(),
    })),
  );
  return {
    path,
    g,
    commit,
    root,
    first,
    head,
    merge,
    app,
    repo,
    pr,
    snapshot,
    async close() {
      await app.close();
      rmSync(path, { recursive: true, force: true });
    },
  };
}
test("conflict-resolved squash, behind PR head, extra commits, history and landing", async () => {
  const f = fixture();
  try {
    f.g("branch", "-f", "topic", f.first);
    f.app.db.replaceHost("local", [f.snapshot()]);
    await rebuildProvenance(f.app, f.repo);
    const b = f.app.getBranch(f.repo + "#topic")!;
    expect(b.verdict).toBe("delete");
    expect(b.clones[0].state).toBe("pr-merged");
    expect(b.landedVia?.matchedSha).toBe(f.first);
    expect(f.app.getCommitProvenance({ repo: f.repo, sha: f.merge })?.via).toBe(
      "merge-commit-sha",
    );
    expect(
      f.app.listLandings({ repo: f.repo }).items.find((l) => l.sha === f.merge)
        ?.branchIds,
    ).toContain(f.repo + "#topic");
    f.g("checkout", "topic");
    f.g("reset", "--hard", f.head);
    const extra = f.commit("new work");
    f.g("checkout", "main");
    f.app.db.replaceHost("local", [f.snapshot()]);
    await rebuildProvenance(f.app, f.repo);
    const changed = f.app.getBranch(f.repo + "#topic")!;
    expect(changed.verdict).toBe("pr-merged-changed");
    expect(changed.landedVia?.extraCommitShas).toEqual([extra]);
    expect(changed.clones[0].commits).toEqual([extra]);
    f.g("branch", "-D", "topic");
    const gone: Clone = {
      ...f.snapshot(),
      branches: f.snapshot().branches.filter((b) => b.name !== "topic"),
    };
    f.app.db.replaceHost("local", [gone]);
    await rebuildProvenance(f.app, f.repo);
    expect(
      f.app
        .listBranchHistory({ gone: true })
        .items.some(
          (h) => h.sha === extra && h.goneAt && h.landedVia?.extraCommits === 1,
        ),
    ).toBe(true);
    expect(f.app.db.commits(f.pr.id).length).toBe(2);
  } finally {
    await f.close();
  }
});
test("message patterns and merge trailer round trip with recorded payloads", () => {
  expect(
    parseProvenance(
      "Merge pull request 'Feature' (#12) from feature/topic into main",
    ),
  ).toMatchObject({ number: 12, branch: "feature/topic" });
  expect(
    parseProvenance("Merge pull request #14 from owner/feature/topic"),
  ).toMatchObject({ number: 14, branch: "feature/topic" });
  expect(parseProvenance("Title (#15)")).toMatchObject({ number: 15 });
  expect(parseProvenance("Merge branch 'topic'")).toMatchObject({
    branch: "topic",
  });
  const pr = normalizePullRequest("github.com/example/project", "github", {
    number: 1,
    head: { ref: "topic", sha: "abc" },
    base: { ref: "main" },
    html_url: "https://github.com/example/project/pull/1",
  });
  expect(mergeTrailers("github", pr)).toEqual({
    commit_message:
      "Source-Branch: topic\nSource-Head: abc\nSource-PR: https://github.com/example/project/pull/1",
  });
  const forgejo = mergeTrailers("forgejo", pr);
  expect(parseProvenance(forgejo.MergeMessageField!)).toMatchObject({
    trailerBranch: "topic",
    trailerUrl: pr.url,
  });
});
test("worker accepts a merged PR commit and refuses stale evidence or changed tip", async () => {
  const f = fixture();
  try {
    const item: Action = {
      id: "action",
      host: "local",
      repo: f.path,
      branch: "topic",
      sha: f.head,
      base: "main",
      baseSha: f.merge,
      state: "pr-merged",
      archive: false,
      remote: "origin",
      prEvidence: { id: f.pr.id, state: "merged", commits: [f.first, f.head] },
    };
    expect(execute(item, false, { t3: false, cwds: [] }).status).toBe(
      "planned",
    );
    expect(
      execute(
        { ...item, prEvidence: { ...item.prEvidence!, state: "closed" } },
        false,
        { t3: false, cwds: [] },
      ).status,
    ).toBe("blocked");
    expect(
      execute(
        { ...item, prEvidence: { ...item.prEvidence!, commits: [] } },
        false,
        { t3: false, cwds: [] },
      ).status,
    ).toBe("blocked");
    expect(
      execute({ ...item, sha: f.first }, false, { t3: false, cwds: [] }).status,
    ).toBe("blocked");
    expect(execute(item, true, { t3: false, cwds: [] }).status).toBe("done");
    expect(
      git(f.path, "rev-parse", "--verify", "refs/heads/topic").code,
    ).not.toBe(0);
  } finally {
    await f.close();
  }
});
test("provenance verdict combination protects active and changed clones", () => {
  const clone = {
    state: "pr-merged" as const,
    sha: "a",
    dirty: false,
    active: false,
    unpushed: 2,
  };
  expect(verdict([clone])).toBe("delete");
  expect(verdict([{ ...clone, active: true }])).toBe("check");
  expect(verdict([clone, { ...clone, state: "pr-merged-changed" }])).toBe(
    "pr-merged-changed",
  );
  expect(verdict([clone, { ...clone, state: "unmerged" }])).toBe("local-only");
});

test("incremental sync follows updated_at pages and retains deleted forge branches", async () => {
  const { ForgeService } = await import("./forge");
  const app = makeApplication(":memory:");
  app.updateSettings({
    ...app.settings(),
    forges: [{ host: "github.com", kind: "github" }],
  });
  const repo = "github.com/example/project";
  let calls: string[] = [];
  let updated = "2026-01-01T00:00:00Z";
  class Recorded extends ForgeService {
    override async request(_host: string, path: string): Promise<unknown> {
      calls.push(path);
      if (path.includes("pulls?"))
        return [
          {
            number: 7,
            title: "Feature",
            html_url: "https://github.com/example/project/pull/7",
            head: { ref: "gone", sha: "final" },
            base: { ref: "main" },
            state: "closed",
            merged_at: updated,
            updated_at: updated,
            merge_commit_sha: "squash",
          },
        ];
      if (path.includes("/commits?"))
        return [
          {
            sha: "first",
            commit: {
              message: "Feature",
              author: { name: "Test", date: updated },
            },
          },
        ];
      if (path.includes("check-runs")) return { check_runs: [] };
      if (path.includes("actions/runs")) return { workflow_runs: [] };
      return [];
    }
  }
  app.forge = () => new Recorded(app.settings().forges);
  try {
    await app.syncPullRequests({ repo, full: true });
    expect(app.db.commits(repo + "!7").map((c) => c.sha)).toEqual(["first"]);
    calls = [];
    await app.syncPullRequests({ repo });
    expect(calls.some((p) => p.includes("/commits?"))).toBe(false);
    expect(app.listPullRequests({ state: "merged" }).total).toBe(1);
    updated = "2026-01-02T00:00:00Z";
    await app.syncPullRequests({ repo });
    expect(app.listPullRequests({ state: "merged" }).items[0].updatedAt).toBe(
      updated,
    );
  } finally {
    await app.close();
  }
});

test("missing worktree is not dirty and dashboard ignores it", async () => {
  const { worktree } = await import("../collector/analyze");
  const app = makeApplication(":memory:");
  try {
    const w = worktree(
      "/does/not/exist",
      { worktree: "/does/not/exist", HEAD: "abc", branch: "refs/heads/topic" },
      false,
    );
    expect(w.exists).toBe(false);
    expect(w.dirty).toBe(false);
    app.db.replaceHost("local", [
      {
        path: "/tmp/clone",
        commonDir: "",
        key: "example.com/org/repo",
        name: "repo",
        roots: [],
        remotes: [],
        bases: [],
        branches: [],
        remoteBranches: [],
        worktrees: [w],
        stashes: [],
        threads: [],
        about: "",
        errors: [],
      } as Clone,
    ]);
    expect(app.dashboard().dirtyWorktrees).toBe(0);
  } finally {
    await app.close();
  }
});

test("trailers explain a base commit without forge data; remote refs get provenance", async () => {
  const f = fixture();
  try {
    f.g(
      "commit",
      "--allow-empty",
      "-m",
      "Independent landing\n\nSource-Branch: archived/topic\nSource-Head: deadbeef\nSource-PR: https://example.com/org/repo/pulls/99",
    );
    const sha = f.g("rev-parse", "HEAD");
    const clone = f.snapshot();
    const remote = {
      ...clone.branches.find((b) => b.name === "topic")!,
      name: "origin/topic",
    };
    f.app.db.replaceHost("local", [
      { ...clone, remoteBranches: [remote] } as Clone,
    ]);
    await rebuildProvenance(f.app, f.repo);
    expect(f.app.getCommitProvenance({ repo: f.repo, sha })).toMatchObject({
      via: "trailer",
      sourceBranch: "archived/topic",
      number: 99,
      pullRequestId: null,
    });
    expect(
      f.app.getRepository(f.repo).clones[0].remoteBranches[0],
    ).toMatchObject({
      state: "pr-merged",
      landedVia: { pullRequestId: f.pr.id },
    });
  } finally {
    await f.close();
  }
});

test("token commands are asynchronous and shared across service instances", async () => {
  const { ForgeService } = await import("./forge");
  const dir = mkdtempSync(join(tmpdir(), "token-test-"));
  const marker = join(dir, "calls");
  const previous = globalThis.fetch;
  const fake = (async () =>
    new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
  globalThis.fetch = fake;
  try {
    const config = [
      {
        host: "example.com",
        kind: "forgejo" as const,
        tokenCommand: `printf x >> '${marker}'; printf fixture-token`,
      },
    ];
    await Promise.all([
      new ForgeService(config).request("example.com", "/test"),
      new ForgeService(config).request("example.com", "/test"),
    ]);
    expect(await Bun.file(marker).text()).toBe("x");
  } finally {
    globalThis.fetch = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merge operations send provenance in both forge payload formats (fixtures only)", async () => {
  const { ForgeService } = await import("./forge");
  for (const kind of ["github", "forgejo"] as const) {
    const app = makeApplication(":memory:");
    let merged = false;
    let payload: Record<string, unknown> = {};
    app.updateSettings({
      ...app.settings(),
      forges: [{ host: "example.com", kind }],
    });
    class Recorded extends ForgeService {
      override async request(
        _host: string,
        path: string,
        _method = "GET",
        _body?: unknown,
        raw = false,
      ): Promise<unknown> {
        if (raw) return "";
        if (/\/pulls\/7$/.test(path))
          return {
            number: 7,
            title: "Feature",
            body: "Original body",
            html_url: "https://example.com/org/repo/pull/7",
            head: { ref: "topic", sha: "abc" },
            base: { ref: "main" },
            state: merged ? "closed" : "open",
            merged,
            merged_at: merged ? "2026-01-01" : null,
          };
        if (path.includes("check-runs")) return { check_runs: [] };
        if (path.includes("actions/runs")) return { workflow_runs: [] };
        return [];
      }
      override async operation(
        _key: string,
        op: string,
        input: Record<string, unknown>,
      ) {
        expect(op).toBe("merge");
        payload = input;
        merged = true;
        return { merged: true };
      }
    }
    app.forge = () => new Recorded(app.settings().forges);
    try {
      await app.mergePullRequest({
        id: "example.com/org/repo!7",
        method: "squash",
        deleteRemoteBranch: false,
      });
      const text = String(
        kind === "github" ? payload.commit_message : payload.MergeMessageField,
      );
      expect(text).toContain("Original body\n\nSource-Branch: topic");
      expect(text).toContain("Source-Head: abc");
      expect(text).toContain("Source-PR: https://example.com/org/repo/pull/7");
    } finally {
      await app.close();
    }
  }
});

test("PR ancestors preserve existing Git integration", () => {
  const via = {
    pullRequestId: "repo!1",
    number: 1,
    url: "https://example.com/pull/1",
    method: "squash" as const,
    mergeCommitSha: "merge",
    matchedSha: "head",
    extraCommits: 1,
    extraCommitShas: ["extra"],
  };
  expect(landedState("merged", via)).toBe("merged");
  expect(landedState("squash-merged", via)).toBe("squash-merged");
  expect(landedState("unmerged", via)).toBe("pr-merged-changed");
});
