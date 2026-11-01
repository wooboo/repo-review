import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../collector/git";
import { makeApplication } from "./application";
import { normalizePullRequest } from "./pull-requests";
import { repositoryOwnership } from "../domain/ownership";
import { callTool, toolList } from "../mcp/server";

const own = "forge.example/mine/project";
const other = "forge.example/upstream/project";
const clone = (key: string) => ({
  key,
  name: "project",
  path: `/fixture/${key}`,
  commonDir: `/fixture/${key}/.git`,
  roots: [],
  remotes: [],
  bases: [],
  remoteBranches: [],
  stashes: [],
  threads: [],
  about: "",
  errors: [],
  branches: [
    {
      name: "topic",
      sha: "abc",
      date: "2020-01-01",
      state: "merged",
      unpushed: 0,
      commits: [],
    },
  ],
  worktrees: [
    {
      path: `/fixture/${key}`,
      branch: "topic",
      exists: true,
      dirty: true,
      files: [],
    },
  ],
});
const pr = (repo: string, number: number, author: string) =>
  normalizePullRequest(repo, "forgejo", {
    number,
    title: "Feature",
    state: "open",
    user: { login: author },
    head: { ref: "topic", sha: "abc" },
    base: { ref: "main" },
    updated_at: "2026-01-01T00:00:00Z",
  });

test("ownership is case insensitive and defaults to mine for unconfigured or local work", () => {
  const forges = [
    { host: "forge.example", kind: "forgejo" as const, owners: ["MINE"] },
  ];
  expect(repositoryOwnership(own, forges)).toEqual({
    owner: "mine",
    mine: true,
  });
  expect(repositoryOwnership(other, forges).mine).toBe(false);
  expect(
    repositoryOwnership(other, [{ ...forges[0], owners: undefined }]).mine,
  ).toBe(true);
  expect(repositoryOwnership(other, [{ ...forges[0], owners: [] }]).mine).toBe(
    true,
  );
  expect(repositoryOwnership("local/project@abc", forges)).toEqual({
    owner: null,
    mine: true,
  });
  expect(repositoryOwnership(other, []).mine).toBe(true);
});

test("mute survives rescan and restart; visibility and ownership precede paging and dashboard counts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "review-visibility-"));
  const path = join(dir, "test.db");
  let app = makeApplication(path);
  try {
    app.updateSettings({
      ...app.settings(),
      forges: [{ host: "forge.example", kind: "forgejo", owners: ["MINE"] }],
    });
    app.db.replaceHost("fixture", [clone(own), clone(other)]);
    app.reindexBranches();
    for (const p of [
      pr(own, 1, "outsider"),
      pr(other, 2, "MiNe"),
      pr(other, 3, "outsider"),
    ])
      app.db.put("pull_request", p.id, p);
    expect(
      app.listRepositories({ mine: true }).items.map((r) => r.key),
    ).toEqual([own]);
    expect(
      app.listRepositories({ mine: false }).items.map((r) => r.key),
    ).toEqual([other]);
    expect(
      app.listPullRequests({ mine: true }).items.map((p) => p.repo),
    ).toEqual([other]);
    expect(app.listPullRequests({ mine: false }).total).toBe(2);
    app.db.put("landing", "example", {
      repo: other,
      sha: "abc",
      at: "2026-01-01",
      base: "main",
    });
    app.db.put("agent", "example", { repo: other, status: "running" });
    expect(app.dashboard().runningAgentRuns).toBe(1);
    await callTool(app, "set_repository_muted", {
      repositoryId: other,
      muted: true,
    });
    app.db.replaceHost("fixture", [clone(own), clone(other)]);
    expect(app.getRepository(other)).toMatchObject({
      owner: "upstream",
      mine: false,
      muted: true,
    });
    expect(app.getBranch(other + "#topic")).not.toBeNull();
    for (const page of [
      app.listRepositories({ pageSize: 1 }),
      app.searchBranches({ pageSize: 1 }),
      app.listWorktrees({ pageSize: 1 }),
      app.listPullRequests({ pageSize: 1 }),
      app.listBranchHistory({ pageSize: 1 }),
    ]) {
      expect(page.total).toBe(1);
      expect(page.items).toHaveLength(1);
    }
    expect(app.listRepositories({ includeMuted: true }).total).toBe(2);
    expect(app.searchBranches({ includeMuted: true }).total).toBe(2);
    expect(app.listWorktrees({ includeMuted: true }).total).toBe(2);
    expect(
      app.listPullRequests({ includeMuted: true, pageSize: 1, page: 2 }).total,
    ).toBe(3);
    expect(
      app.listPullRequests({ includeMuted: true, mine: true }).items[0].mine,
    ).toBe(true);
    expect(app.listBranchHistory({ includeMuted: true }).total).toBe(2);
    expect(app.listLandings({ repo: other, since: "2020-01-01" }).total).toBe(
      0,
    );
    expect(
      app.listLandings({ repo: other, since: "2020-01-01", includeMuted: true })
        .total,
    ).toBe(1);
    expect(
      app.listLandings({
        repo: other,
        since: "2020-01-01",
        includeMuted: true,
        mine: true,
      }).total,
    ).toBe(0);
    expect(app.dashboard()).toMatchObject({
      repositories: 1,
      clones: 1,
      branches: 1,
      dirtyWorktrees: 1,
      openPullRequests: 1,
      mutedRepositories: 1,
      runningAgentRuns: 0,
    });
    app.db.put("agent", "example", { repo: other, status: "done" });
    const cleanClones = [own, other].map((key) => ({
      ...clone(key),
      worktrees: [],
    }));
    app.db.replaceHost("fixture", cleanClones);
    const search = app.searchBranches;
    let cleanupRepos: string[] = [];
    // Observe cleanup selection without launching a worker against a synthetic clone.
    app.searchBranches = (input = {}) => {
      const result = search(input);
      cleanupRepos = result.items.map((b) => b.repo);
      return { ...result, items: [], total: 0 };
    };
    await app.planCleanup();
    app.searchBranches = search;
    expect(cleanupRepos).toContain(other);
    await app.close();
    app = makeApplication(path);
    expect(app.getRepository(other).muted).toBe(true);
    expect(app.listRepositories().total).toBe(1);
    app.setRepositoryMuted({ repositoryId: other, muted: false });
    expect(app.listRepositories().total).toBe(2);
    // Ownership reads change immediately without rescanning PRs.
    app.updateSettings({
      ...app.settings(),
      forges: [{ host: "forge.example", kind: "forgejo" }],
    });
    expect(app.listPullRequests({ mine: true }).total).toBe(3);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bulk sync skips muted clones but explicit sync honors the repository", async () => {
  const app = makeApplication(":memory:");
  try {
    app.updateSettings({
      ...app.settings(),
      forges: [{ host: "forge.example", kind: "forgejo" }],
    });
    app.db.replaceHost("fixture", [clone(own), clone(other)]);
    app.setRepositoryMuted({ repositoryId: other, muted: true });
    const called: string[] = [];
    const service = app.forge();
    service.prepare = async () => {};
    service.listPullRequests = async (key) => {
      called.push(key);
      return [];
    };
    await app.syncPullRequests();
    expect(called).toEqual([own]);
    called.length = 0;
    await app.syncPullRequests({ repo: other });
    expect(called).toEqual([other]);
    called.length = 0;
    await app.refreshPullRequests();
    expect(called).toEqual([own]);
  } finally {
    await app.close();
  }
});

test("every MCP tool and nested input field has a meaningful description", () => {
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties")
        for (const field of Object.values(
          value as Record<string, { description: string }>,
        ))
          expect(field.description.length).toBeGreaterThan(15);
      visit(value);
    }
  };
  for (const tool of toolList()) {
    expect(tool.description.length).toBeGreaterThan(25);
    expect(tool.description).not.toBe(tool.name.replaceAll("_", " "));
    visit(tool.inputSchema);
  }
});

test("scheduled scans still collect muted clones without triggering their PR sync", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-muted-scan-"));
  const app = makeApplication(":memory:");
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Fixture");
    git(root, "config", "user.email", "fixture@example.com");
    writeFileSync(join(root, "file"), "fixture");
    git(root, "add", ".");
    git(root, "commit", "-m", "fixture");
    app.updateSettings({
      ...app.settings(),
      hosts: [
        {
          id: "primary",
          kind: "local",
          roots: [],
          enabled: true,
          bun: process.execPath,
        },
        {
          id: "fixture",
          kind: "local",
          roots: [root],
          enabled: true,
          bun: process.execPath,
        },
      ],
      forges: [{ host: "forge.example", kind: "forgejo" }],
    });
    app.db.replaceHost("fixture", [clone(other)]);
    app.setRepositoryMuted({ repositoryId: other, muted: true });
    app.forge().resolveIdentity = async () => ({ key: other, unrelated: [] });
    app.refreshPullRequests = async () => {
      throw Error("Muted repository must not sync");
    };
    const { id } = app.startScan(
      { hosts: ["fixture"], fetch: false },
      "schedule",
    );
    for (
      let i = 0;
      i < 300 && ["queued", "running"].includes(app.getScan(id)!.status);
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(app.getScan(id)).toMatchObject({ status: "done", errors: [] });
    expect(
      app
        .getScan(id)!
        .events.some((e) => JSON.stringify(e).includes("forge-unavailable")),
    ).toBe(false);
    expect(app.getRepository(other).clones[0].path).toBe(root);
    expect(app.getRepository(other).muted).toBe(true);
    expect(app.listRepositories().total).toBe(0);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
