import { test, expect } from "bun:test";
import { BudgetGuard, ForgeRateLimited } from "./forge-budget";
import { ForgeService, mapGithubPull, type GithubPull } from "./forge";
import { makeApplication } from "./application";
import { createCoalescer } from "./events";
import { startJob, resumeSyncJobs } from "./jobs";
import fixture from "./fixtures/github-graphql.json";

const clone = {
  path: "/nonexistent",
  commonDir: "/nonexistent/.git",
  key: "github.com/example/project",
  name: "project",
  roots: [],
  branches: [],
  remoteBranches: [],
  bases: [],
  worktrees: [],
  threads: [],
  remotes: [],
  stashes: [],
  about: "",
  errors: [],
};
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
test("primary reserve, retry-after, secondary limits and reset resume", async () => {
  const old = globalThis.fetch;
  let requests = 0;
  const budget = new BudgetGuard();
  const service = new ForgeService(
    [{ host: "github.com", kind: "github" }],
    budget,
  );
  globalThis.fetch = (async () => {
    requests++;
    return Response.json(
      {},
      {
        headers: {
          "x-ratelimit-remaining": "1000",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        },
      },
    );
  }) as unknown as typeof fetch;
  try {
    await service.request("github.com", "/first");
    await expect(
      service.request("github.com", "/blocked"),
    ).rejects.toBeInstanceOf(ForgeRateLimited);
    expect(requests).toBe(1);
    budget.update(
      "github.com",
      "core",
      1000,
      new Date(Date.now() - 1).toISOString(),
      1000,
    );
    await service.request("github.com", "/after-reset");
    expect(requests).toBe(2);
    budget.budgets.clear();
    globalThis.fetch = (async () =>
      Response.json(
        { message: "secondary rate limit" },
        { status: 403, headers: { "retry-after": "60" } },
      )) as unknown as typeof fetch;
    await expect(
      service.request("github.com", "/secondary"),
    ).rejects.toBeInstanceOf(ForgeRateLimited);
    expect(
      Date.parse(budget.budgets.get("github.com:core")!.pausedUntil!) >
        Date.now(),
    ).toBe(true);
    await expect(
      service.request("github.com", "/graphql", "POST", {}),
    ).rejects.toBeInstanceOf(ForgeRateLimited);
  } finally {
    globalThis.fetch = old;
  }
});
test("Forgejo optional rate headers and conditional REST responses", async () => {
  const old = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    seen.push(new Headers(init?.headers).get("if-none-match") ?? "");
    return seen.length === 1
      ? Response.json([1], {
          headers: {
            etag: '"v1"',
            "x-ratelimit-remaining": "10",
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
          },
        })
      : new Response(null, { status: 304 });
  }) as unknown as typeof fetch;
  try {
    const f = new ForgeService([{ host: "forge.example", kind: "forgejo" }]);
    expect(await f.request("forge.example", "/test")).toEqual([1]);
    expect(await f.request("forge.example", "/test")).toEqual([1]);
    expect(seen).toEqual(["", '"v1"']);
    expect(f.budget.budgets.get("forge.example:core")?.remaining).toBe(10);
  } finally {
    globalThis.fetch = old;
  }
});
test("sanitized GraphQL fixture maps PR metadata, checks, and merge SHA", () => {
  const mapped = mapGithubPull(fixture as GithubPull);
  expect(mapped).toMatchObject({
    number: 7,
    head: { ref: "topic", sha: "head-one" },
    merge_commit_sha: "squash-one",
    checkState: "success",
    reviewDecision: "APPROVED",
  });
});
test("watermark stops pages; head SHA cache avoids repeat commits and excludes upstreams", async () => {
  const old = globalThis.fetch,
    app = makeApplication(":memory:");
  app.updateSettings({
    ...app.settings(),
    forges: [{ host: "github.com", kind: "github" }],
  });
  app.db.replaceHost("local", [clone]);
  let head = "head-one",
    updated = "2026-01-02T00:00:00Z",
    commits = 0,
    pages = 0;
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(url).endsWith("/rate_limit"))
      return Response.json({
        resources: {
          core: {
            remaining: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
          graphql: {
            remaining: 5000,
            reset: Math.floor(Date.now() / 1000) + 3600,
          },
        },
      });
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("pullRequests(")) {
      pages++;
      return Response.json({
        data: {
          repository: {
            pullRequests: {
              nodes: [
                { ...fixture, headRefOid: head, updatedAt: updated },
                {
                  ...fixture,
                  number: 8,
                  headRepository: { nameWithOwner: "upstream/project" },
                },
                { ...fixture, number: 9, state: "CLOSED", mergedAt: null },
                { ...fixture, number: 10, updatedAt: "2020-01-01T00:00:00Z" },
              ],
              pageInfo: { hasNextPage: true, endCursor: "older" },
            },
          },
        },
      });
    }
    commits++;
    expect(query).toContain("p7: pullRequest");
    expect(query).not.toContain("p8:");
    expect(query).not.toContain("p9:");
    return Response.json({
      data: {
        repository: {
          p7: {
            commits: {
              nodes: [
                {
                  commit: {
                    oid: head,
                    messageHeadline: "Feature",
                    author: { name: "Fixture", date: updated },
                  },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
  }) as unknown as typeof fetch;
  try {
    app.db.put("settings", "pr-sync:" + clone.key, "2026-01-01T00:00:00Z");
    await app.syncPullRequests();
    expect(pages).toBe(1);
    expect(commits).toBe(1);
    expect(app.db.commits(clone.key + "!7")[0].subject).toBe("Feature");
    await app.syncPullRequests();
    expect(commits).toBe(1);
    head = "head-two";
    updated = "2026-01-03T00:00:00Z";
    await app.syncPullRequests();
    expect(commits).toBe(2);
    expect(app.db.get("settings", "pr-sync:" + clone.key)).toBe(updated);
    expect(app.dashboard().forgeBudgets).toHaveLength(2);
    app.db.put("settings", "pr-sync:" + clone.key, "unchanged");
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 429,
        headers: { "retry-after": "60" },
      })) as unknown as typeof fetch;
    await expect(app.syncPullRequests()).rejects.toBeInstanceOf(
      ForgeRateLimited,
    );
    expect(app.db.get("settings", "pr-sync:" + clone.key)).toBe("unchanged");
  } finally {
    globalThis.fetch = old;
    await app.close();
  }
});
test("sync skips repositories without a local clone or configured forge", async () => {
  const app = makeApplication(":memory:");
  app.updateSettings({
    ...app.settings(),
    forges: [{ host: "github.com", kind: "github" }],
  });
  app.db.put("repository", clone.key, { key: clone.key });
  const old = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw Error("must not fetch");
  }) as unknown as typeof fetch;
  try {
    expect(await app.syncPullRequests()).toEqual([]);
  } finally {
    globalThis.fetch = old;
    await app.close();
  }
});
test("SSE coalesces by type and repo over a burst", async () => {
  const events: unknown[] = [];
  const emit = createCoalescer((e) => events.push(e), 15);
  for (let i = 0; i < 100; i++) emit({ type: "pull-requests", id: "repo" });
  emit({ type: "inventory", id: "repo" });
  expect(events).toHaveLength(0);
  await pause(25);
  expect(events).toEqual([
    { type: "pull-requests", id: "repo" },
    { type: "inventory", id: "repo" },
  ]);
});
test("paused jobs persist a typed error and resume under the same job id", async () => {
  const app = makeApplication(":memory:");
  try {
    const { id } = startJob(
      app,
      "sync-pull-requests",
      async () => {
        throw new ForgeRateLimited({
          host: "github.com",
          retryAt: new Date(Date.now() - 1).toISOString(),
          message: "Paused until reset",
        });
      },
      { repo: clone.key },
    );
    await pause();
    expect(app.db.get<{ status: string }>("job", id)?.status).toBe("paused");
    app.syncPullRequests = async (input) => {
      expect(input?.repo).toBe(clone.key);
      return [];
    };
    resumeSyncJobs(app);
    await pause();
    expect(app.db.get<{ status: string }>("job", id)?.status).toBe("done");
  } finally {
    await app.close();
  }
});
test("missing is independent of dirty; clone ids are unique across hosts", async () => {
  const app = makeApplication(":memory:");
  try {
    const c = {
      ...clone,
      worktrees: [{ path: "/missing", exists: false, dirty: true, files: [] }],
    };
    app.db.replaceHost("one", [c]);
    app.db.replaceHost("two", [c]);
    const rows = app.listWorktrees({ missing: true });
    expect(rows.total).toBe(2);
    expect(rows.items.every((w) => w.missing && !w.dirty)).toBe(true);
    expect(app.listWorktrees({ dirty: true }).total).toBe(0);
    expect(app.dashboard().missingWorktrees).toBe(2);
    const clones = app.db.list<{ id: string }>("clone");
    expect(new Set(clones.map((c) => c.id)).size).toBe(2);
  } finally {
    await app.close();
  }
});

test("sync safety ceiling refuses request 281", async () => {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({});
  }) as unknown as typeof fetch;
  try {
    const f = new ForgeService([{ host: "github.com", kind: "github" }]);
    f.syncActive = true;
    f.syncRequests = 279;
    await f.request("github.com", "/last");
    await expect(f.request("github.com", "/over")).rejects.toBeInstanceOf(
      ForgeRateLimited,
    );
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = old;
  }
});

test("PR checks and history text filtering happen before pagination", async () => {
  const { normalizePullRequest } = await import("./pull-requests");
  const app = makeApplication(":memory:");
  try {
    for (let n = 1; n <= 3; n++) {
      const pr = normalizePullRequest(clone.key, "github", {
        number: n,
        title: `Feature ${n}`,
        state: "open",
        head: { ref: `topic-${n}`, sha: `sha-${n}` },
        base: { ref: "main" },
      });
      app.db.put("pull_request", pr.id, {
        ...pr,
        checks: {
          state: n === 1 ? "success" : "failure",
          total: 1,
          failed: Number(n !== 1),
          pending: 0,
        },
      });
      app.db.put("branch_history", String(n), {
        host: "local",
        repo: clone.key,
        clonePath: "/fixture",
        branch: n === 3 ? "needle" : `topic-${n}`,
        sha: `sha-${n}`,
        firstSeen: "2026-01-01",
        lastSeen: "2026-01-01",
        goneAt: "2026-01-02",
        landedVia: null,
      });
    }
    const prs = app.listPullRequests({ checks: "failure", pageSize: 1 });
    expect(prs.total).toBe(2);
    expect(prs.items).toHaveLength(1);
    const history = app.listBranchHistory({
      text: "NEEDLE",
      gone: true,
      pageSize: 1,
    });
    expect(history.total).toBe(1);
    expect(history.items[0].branch).toBe("needle");
  } finally {
    await app.close();
  }
});
