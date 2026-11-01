import githubFixture from "./fixtures/github-pull.json";
import forgejoFixture from "./fixtures/forgejo-pull.json";
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeApplication } from "./application";
import { taskPrompt, getRun } from "./agents";
import { normalizePullRequest, normalizeDetail } from "./pull-requests";
import { toolList } from "../mcp/server";
import { collectRepo } from "../collector/analyze";
import { git, out } from "../collector/git";
import { executeExtra, type WorkerAction } from "../collector/action-worker";
import type { AgentRunInput } from "../domain/model";
const safe = { t3: false, cwds: [] };
function fixture(work: (p: string) => void) {
  const p = mkdtempSync(join(tmpdir(), "review-v2-"));
  try {
    git(p, "init", "-b", "main");
    git(p, "config", "user.name", "Test");
    git(p, "config", "user.email", "test@example.com");
    writeFileSync(join(p, "f"), "root");
    git(p, "add", ".");
    git(p, "commit", "-m", "root");
    git(p, "branch", "feature");
    writeFileSync(join(p, ".git/info/exclude"), "w/\nbare/\n");
    work(p);
  } finally {
    rmSync(p, { recursive: true, force: true });
  }
}
function action(
  p: string,
  kind: WorkerAction["kind"],
  extra: Partial<WorkerAction["target"]> = {},
): WorkerAction {
  return {
    id: "a",
    kind,
    target: { host: "local", repo: p, branch: "feature", ...extra },
    branchId: null,
    repoKey: "example/repo",
    sha: out(p, "rev-parse", "feature"),
    base: "main",
    baseSha: out(p, "rev-parse", "main"),
    remoteUrl: out(p, "remote", "get-url", "origin"),
    status: "planned",
    reason: "",
    restore: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}
test("switch detaches clean base holder at same SHA and refuses dirty checkout", () =>
  fixture((p) => {
    const w = join(p, "w");
    git(p, "worktree", "add", w, "feature");
    const a = action(p, "switch-to-base", { worktree: w });
    writeFileSync(join(w, "untracked"), "dirty");
    expect(executeExtra(a, true, safe).status).toBe("blocked");
    rmSync(join(w, "untracked"));
    expect(executeExtra(a, true, safe).status).toBe("done");
    expect(out(w, "branch", "--show-current")).toBe("main");
    expect(out(p, "branch", "--show-current")).toBe("");
  }));
test("prune refuses staged index in missing worktree", () =>
  fixture((p) => {
    const w = join(p, "w");
    git(p, "worktree", "add", w, "feature");
    writeFileSync(join(w, "f"), "staged");
    git(w, "add", "f");
    const a = action(p, "prune-worktree", { worktree: w });
    rmSync(w, { recursive: true });
    expect(executeExtra(a, true, safe).reason).toContain("staged");
    expect(out(p, "worktree", "list", "--porcelain")).toContain(w);
  }));
test("prune removes clean missing worktree", () =>
  fixture((p) => {
    const w = join(p, "w");
    git(p, "worktree", "add", w, "feature");
    const a = action(p, "prune-worktree", { worktree: w });
    rmSync(w, { recursive: true });
    expect(executeExtra(a, true, safe).status).toBe("done");
  }));
test("push rechecks SHA and URL; URL edits recheck old URL", () =>
  fixture((p) => {
    const remote = join(p, "bare");
    git(p, "init", "--bare", remote);
    git(p, "remote", "add", "origin", remote);
    const a = action(p, "push-branch");
    expect(executeExtra({ ...a, sha: "bad" }, true, safe).status).toBe(
      "blocked",
    );
    expect(
      executeExtra({ ...a, remoteUrl: "changed" }, true, safe).status,
    ).toBe("blocked");
    expect(executeExtra(a, true, safe).status).toBe("done");
    const edit = action(p, "set-remote-url", { url: remote + "-new" });
    expect(executeExtra(edit, true, safe).status).toBe("done");
    expect(executeExtra(edit, true, safe).status).toBe("blocked");
  }));
test("fast forward refuses rewritten target and divergence", () =>
  fixture((p) => {
    const a = action(p, "fast-forward-base");
    writeFileSync(join(p, "f"), "new");
    git(p, "commit", "-am", "new");
    expect(executeExtra(a, true, safe).status).toBe("blocked");
    const b = action(p, "fast-forward-base");
    expect(executeExtra(b, true, safe).status).toBe("done");
    expect(out(p, "rev-parse", "feature")).toBe(out(p, "rev-parse", "main"));
  }));
test("normalized forge payloads and byte bounded diff", () => {
  for (const forge of ["github", "forgejo"] as const) {
    const pr = normalizePullRequest(
      "example.test/team/repo",
      forge,
      {
        number: 3,
        title: "Fix",
        html_url: "https://example.test/team/repo/pulls/3",
        user: { login: "tester" },
        head: { ref: "feature", sha: "abc" },
        base: { ref: "main" },
        state: "open",
        created_at: "2026-01-01",
        updated_at: "2026-01-02",
      },
      true,
    );
    const detail = normalizeDetail(
      pr,
      {},
      "é".repeat(300_000),
      [],
      [{ user: { login: "reviewer" }, state: "APPROVED" }],
      [],
      [
        { context: "ci", state: "success" },
        { name: "build", status: "completed", conclusion: "failure" },
      ],
    );
    expect(detail.branchId).toBe("example.test/team/repo#feature");
    expect(detail.checks).toEqual({
      state: "failure",
      failed: 1,
      pending: 0,
      total: 2,
    });
    expect(detail.review).toBe("approved");
    expect(Buffer.byteLength(detail.diff)).toBeLessThanOrEqual(500_000);
    expect(detail.diffTruncated).toBe(true);
  }
});
test("restart recovery and SQL paging/filtering", () => {
  const dir = mkdtempSync(join(tmpdir(), "review-db-")),
    path = join(dir, "state.db");
  let app = makeApplication(path);
  for (const kind of ["scan", "job", "agent"])
    app.db.put(kind, "interrupted", { id: "interrupted", status: "running" });
  app.close();
  app = makeApplication(path);
  try {
    for (const kind of ["scan", "job", "agent"])
      expect(app.db.get<{ status: string }>(kind, "interrupted")?.status).toBe(
        "failed",
      );
    for (let i = 0; i < 6; i++)
      app.db.put("pull_request", String(i), {
        id: String(i),
        repo: i < 4 ? "a" : "b",
        state: i % 2 ? "closed" : "open",
        title: "PR",
      });
    expect(
      app.db.page("pull_request", {
        repo: "a",
        state: "open",
        page: 2,
        pageSize: 1,
      }),
    ).toMatchObject({
      total: 2,
      page: 2,
      items: [{ repo: "a", state: "open" }],
    });
  } finally {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all task templates contain contextual data and note", () => {
  for (const task of [
    "review-branch",
    "make-pr",
    "review-pr",
    "cleanup-repo",
    "describe-repo",
    "custom",
  ] as const) {
    const input: AgentRunInput = {
      agentId: "test",
      repo: "example/repo",
      task,
      note: "User constraint",
      worktree: "none",
    };
    expect(taskPrompt(input, { branch: "feature" })).toContain("feature");
    expect(taskPrompt(input, {})).toContain("User constraint");
  }
});
test("MCP v2 tool inventory", () => {
  const names = toolList().map((t) => t.name);
  for (const name of [
    "plan_actions",
    "apply_actions",
    "list_actions",
    "comment_pull_request",
    "list_agents",
    "cancel_agent_run",
    "refresh_pull_requests",
    "get_job",
  ])
    expect(names).toContain(name);
});
test("run event cursor is monotonic", () => {
  const app = makeApplication(":memory:");
  app.db.put("agent", "r", { id: "r" });
  app.db.put("agent_event", "r:1", {
    runId: "r",
    seq: 1,
    at: "now",
    kind: "message",
    text: "hello",
  });
  expect(getRun(app, "r", 1)?.events).toEqual([]);
  expect(getRun(app, "r", 0)?.cursor).toBe(1);
  app.close();
});

test("recorded sanitized GitHub and Forgejo PR payloads", () => {
  for (const [forge, payload] of [
    ["github", githubFixture],
    ["forgejo", forgejoFixture],
  ] as const) {
    const pr = normalizePullRequest(
      "forge.example/team/repo",
      forge,
      payload,
      true,
    );
    expect(pr.number).toBe(7);
    expect(pr.author).toBe("contributor");
    expect(pr.forge).toBe(forge);
    expect(pr.head).toBe("feature");
  }
});

test("backup uses VACUUM INTO and keeps fourteen valid copies", async () => {
  const { readdirSync } = await import("node:fs");
  const { Database } = await import("bun:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "review-backup-"));
  const app = makeApplication(join(dir, "source.db"));
  try {
    app.db.put("settings", "probe", { value: "durable" });
    for (let i = 0; i < 16; i++) app.db.backup(join(dir, "copies"));
    const files = readdirSync(join(dir, "copies"));
    expect(files).toHaveLength(14);
    const copy = new Database(join(dir, "copies", files[0]), {
      readonly: true,
    });
    expect(copy.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    copy.close();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("SSE emits inventory changes and cancels subscription", async () => {
  const { eventsResponse, emitChange } = await import("./events");
  const response = eventsResponse(new Request("http://localhost/api/events"));
  const reader = response.body!.getReader();
  await reader.read();
  emitChange({ type: "inventory", id: "fixture" });
  let text = "";
  while (!text.includes('"id":"fixture"'))
    text += new TextDecoder().decode((await reader.read()).value);
  expect(text).toContain('"id":"fixture"');
  await reader.cancel();
});

test("daily scan claim survives restart without a double run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-schedule-")),
    path = join(dir, "state.db");
  let app = makeApplication(path);
  let calls = 0;
  const now = new Date(2026, 0, 2, 3, 0);
  const fake = () => {
    calls++;
    return { id: "scheduled" };
  };
  try {
    app.startScan = fake;
    app.runScheduled(now);
    expect(calls).toBe(1);
    await app.close();
    app = makeApplication(path);
    app.startScan = fake;
    app.runScheduled(now);
    expect(calls).toBe(1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fast forward refuses divergent history", () =>
  fixture((p) => {
    git(p, "switch", "feature");
    writeFileSync(join(p, "f"), "feature");
    git(p, "commit", "-am", "feature");
    git(p, "switch", "main");
    writeFileSync(join(p, "f"), "base");
    git(p, "commit", "-am", "base");
    expect(
      executeExtra(action(p, "fast-forward-base"), true, safe).reason,
    ).toContain("Not a fast forward");
  }));
test("push refuses divergent remote history", () =>
  fixture((p) => {
    const remote = join(p, "bare");
    git(p, "init", "--bare", remote);
    git(p, "remote", "add", "origin", remote);
    git(p, "push", "origin", "main:feature");
    writeFileSync(join(p, "f"), "remote");
    git(p, "commit", "-am", "remote");
    git(p, "push", "origin", "main:feature");
    expect(executeExtra(action(p, "push-branch"), true, safe).reason).toContain(
      "not an ancestor",
    );
  }));
test("CLI cancellation terminates descendants", async () => {
  const { startRun, cancelRun } = await import("./agents");
  const { collectRepo } = await import("../collector/analyze");
  const { run } = await import("../collector/git");
  const p = mkdtempSync(join(tmpdir(), "review-cancel-"));
  const app = makeApplication(":memory:");
  try {
    git(p, "init", "-b", "main");
    git(p, "config", "user.name", "Test");
    git(p, "config", "user.email", "test@example.com");
    git(p, "commit", "--allow-empty", "-m", "fixture");
    const clone = collectRepo(join(p, ".git"), p, false);
    app.db.replaceHost("local", [clone]);
    app.updateSettings({
      ...app.settings(),
      agents: [
        {
          id: "fake",
          label: "Test",
          kind: "cli",
          command: process.execPath,
          args: [
            "-e",
            "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);",
          ],
          models: ["test"],
          defaultModel: "test",
        },
      ],
    });
    const { id } = await startRun(app, {
      agentId: "fake",
      repo: clone.key,
      task: "custom",
      worktree: "none",
      note: "fixture",
    });
    let pid = 0;
    for (let n = 0; n < 100; n++) {
      pid = Number(getRun(app, id)?.run.summary?.trim());
      if (pid) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(pid).toBeGreaterThan(0);
    expect(cancelRun(app, id).status).toBe("cancelled");
    await app.close();
    const status = run("ps", ["-p", String(pid), "-o", "stat="]).out.trim();
    expect(status === "" || status.startsWith("Z")).toBe(true);
  } finally {
    await app.close().catch(() => {});
    rmSync(p, { recursive: true, force: true });
  }
});

test("foundation migration preserves settings and invalidates old plans", async () => {
  const { Database } = await import("bun:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "review-upgrade-")),
    path = join(dir, "old.db");
  const defaults = makeApplication(":memory:");
  const settings = { ...defaults.settings(), staleDays: 17 };
  await defaults.close();
  const db = new Database(path);
  const initial = await Bun.file(
    "src/db/migrations/0000_cold_dormammu.sql",
  ).text();
  const journal = await Bun.file("src/db/migrations/meta/_journal.json").json();
  db.exec(initial);
  db.exec(
    "CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  db.query(
    "INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)",
  ).run(
    new Bun.CryptoHasher("sha256").update(initial).digest("hex"),
    journal.entries[0].when,
  );
  db.query("INSERT INTO records(id,kind,json,updated) VALUES (?,?,?,?)").run(
    "settings:main",
    "settings",
    JSON.stringify(settings),
    new Date().toISOString(),
  );
  db.query("INSERT INTO records(id,kind,json,updated) VALUES (?,?,?,?)").run(
    "action:old",
    "action",
    JSON.stringify({ id: "old", status: "planned" }),
    new Date().toISOString(),
  );
  db.close();
  const app = makeApplication(path);
  try {
    expect(app.settings().staleDays).toBe(17);
    expect(app.listActions().total).toBe(0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("forge refresh normalizes summaries without downloading diffs", async () => {
  const { ForgeService } = await import("./forge");
  for (const kind of ["forgejo"] as const) {
    const app = makeApplication(":memory:"),
      calls: string[] = [];
    const fixture = forgejoFixture;
    class RecordedForge extends ForgeService {
      override async request(
        _host: string,
        path: string,
        _method = "GET",
        _body?: unknown,
        raw = false,
      ): Promise<unknown> {
        calls.push(path);
        if (raw) return "diff";
        if (path.includes("/actions/runs")) return { workflow_runs: [] };
        if (path.includes("check-runs")) return { check_runs: [] };
        if (path.includes("/statuses"))
          return [{ context: "ci", state: "success" }];
        if (path.includes("/reviews"))
          return [{ user: { login: "reviewer" }, state: "APPROVED" }];
        if (path.includes("/files") || path.includes("/comments")) return [];
        if (path.includes("pulls?")) return [fixture];
        return fixture;
      }
    }
    app.updateSettings({
      ...app.settings(),
      forges: [{ host: "forge.example", kind }],
    });
    app.db.put("clone", "fixture", {
      key: "forge.example/team/repo",
      branches: [],
      worktrees: [],
      threads: [],
      host: "local",
      path: "/nonexistent",
      bases: [],
      remoteBranches: [],
    });
    app.forge = () => new RecordedForge(app.settings().forges);
    try {
      const values = await app.refreshPullRequests("forge.example/team/repo");
      expect(values[0]?.checks.state).toBe("success");
      expect(values[0]?.review).toBe("approved");
      expect(
        calls.some((c) => c.endsWith("/files") || c.endsWith(".diff")),
      ).toBe(false);
      expect(app.listPullRequests({ state: "all" }).total).toBe(1);
      expect(
        (await app.getPullRequest("forge.example/team/repo!7"))?.diff,
      ).toBe("diff");
    } finally {
      await app.close();
    }
  }
});

test("repository read loads PRs once across grouped repositories", () =>
  fixture((p) => {
    const app = makeApplication(":memory:");
    try {
      const clone = collectRepo(join(p, ".git"), p, false);
      app.db.replaceHost(
        "local",
        Array.from({ length: 6 }, (_, i) => ({
          ...clone,
          key: `forge.example/team/repo${i}`,
          path: join(p, `clone${i}`),
        })),
      );
      const original = app.db.list;
      const calls: Record<string, number> = {};
      app.db.list = <T>(kind: string): T[] => {
        calls[kind] = (calls[kind] ?? 0) + 1;
        return original<T>(kind);
      };
      expect(app.listRepositories().total).toBe(6);
      expect(calls.pull_request).toBeLessThanOrEqual(1);
      expect(calls.agent).toBeLessThanOrEqual(1);
    } finally {
      void app.close();
    }
  }));
