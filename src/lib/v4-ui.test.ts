import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { CloneDeletionSummary, DeletedRepository, Page, PlannedAction, RepositoryDeletionPlan, RepositorySummary, SettingsView } from "./api/types";
import { archivePathFromRestore, archivePathOf, cloneBlocked, confirmMatches, deletionScope, isDeletionConfirmationError, sortDeleted } from "./deletion";
import { formatBytes } from "./format";
import { applyMuted } from "./queries";
import { branchSearch, prListSearch, repoListSearch, visibilityInput, worktreeSearch, REPO_FILTER_KEYS } from "./search";
import { cleanOwners, editedForge, settingsUpdate } from "./settings";
import { currentToasts, dismissToast, toast } from "./toast";

const action = (id: string, status: PlannedAction["status"], extra: Partial<PlannedAction> = {}): PlannedAction => ({
  id,
  kind: "delete-clone",
  target: { host: "box", repo: "/src/demo" },
  branchId: null,
  repoKey: "forge.example/acme/demo",
  status,
  reason: "",
  restore: null,
  createdAt: "2026-01-01T00:00:00Z",
  finishedAt: null,
  ...extra,
});
const clone = (actionId: string, extra: Partial<CloneDeletionSummary> = {}): CloneDeletionSummary => ({
  actionId,
  host: "box",
  path: "/src/demo",
  sizeBytes: 1234,
  linkedWorktrees: [],
  branches: 3,
  unpushedBranches: [],
  dirtyFiles: 0,
  stashes: 0,
  ignoredKept: { files: 0, bytes: 0 },
  ignoredSkipped: { files: 0, bytes: 0 },
  activeThreads: [],
  blockers: [],
  ...extra,
});
const plan = (actions: PlannedAction[], purgesRepository: boolean, remainingClones = 0): RepositoryDeletionPlan => ({
  actions,
  summary: { repositoryId: "forge.example/acme/demo", name: "demo", clones: actions.map((a) => clone(a.id)), remainingClones, purgesRepository, archiveDir: "~/archives" },
});

describe("deletion confirmation", () => {
  test("requires the exact name, ignoring surrounding whitespace", () => {
    expect(confirmMatches("demo", "demo")).toBe(true);
    expect(confirmMatches("  demo ", "demo")).toBe(true);
    expect(confirmMatches("Demo", "demo")).toBe(false);
    expect(confirmMatches("dem", "demo")).toBe(false);
    expect(confirmMatches("de mo", "demo")).toBe(false);
    expect(confirmMatches("", "")).toBe(false);
  });
  test("recognises the server's typed error", () => {
    expect(isDeletionConfirmationError({ _tag: "DeletionConfirmationError", message: "x" })).toBe(true);
    expect(isDeletionConfirmationError(new Error("Confirmation must equal the repository display name"))).toBe(true);
    expect(isDeletionConfirmationError(new Error("Only planned actions can be applied"))).toBe(false);
    expect(isDeletionConfirmationError(null)).toBe(false);
  });
});

describe("deletion scope", () => {
  test("every clone planned: purges the repository", () => {
    expect(deletionScope(plan([action("a", "planned"), action("b", "planned")], true))).toEqual({ ids: ["a", "b"], blocked: 0, purges: true });
  });
  test("a blocked clone keeps the repository", () => {
    expect(deletionScope(plan([action("a", "planned"), action("b", "blocked")], true))).toEqual({ ids: ["a"], blocked: 1, purges: false });
  });
  test("partial selection never purges", () => {
    expect(deletionScope(plan([action("a", "planned")], false, 2))).toEqual({ ids: ["a"], blocked: 0, purges: false });
  });
  test("nothing runnable", () => {
    expect(deletionScope(plan([action("a", "blocked")], true))).toEqual({ ids: [], blocked: 1, purges: false });
  });
  test("a clone with blockers or without its action is blocked", () => {
    expect(cloneBlocked(clone("a"), action("a", "planned"))).toBe(false);
    expect(cloneBlocked(clone("a", { blockers: ["Active T3 thread"] }), action("a", "planned"))).toBe(true);
    expect(cloneBlocked(clone("a"), undefined)).toBe(true);
  });
});

describe("archive paths", () => {
  test("parsed from the restore recipe, including quotes in paths", () => {
    expect(archivePathFromRestore("git clone '/srv/archives/demo/2026-x-box-1/repo.bundle' '/src/demo'; restore stashes…")).toBe("/srv/archives/demo/2026-x-box-1");
    expect(archivePathFromRestore("git clone '/a/it'\\''s/repo.bundle' '/src/demo'")).toBe("/a/it's");
    expect(archivePathFromRestore("git -C /src/demo branch x 123")).toBeNull();
    expect(archivePathFromRestore(null)).toBeNull();
  });
  test("tombstone record wins over the recipe", () => {
    const a = action("a", "done", { restore: "git clone '/from/recipe/repo.bundle' '/src/demo'" });
    const tomb: DeletedRepository[] = [{ id: "forge.example/acme/demo", name: "demo", deletedAt: "2026-01-02T00:00:00Z", clones: [{ host: "box", path: "/src/demo", archivePath: "/from/tombstone" }] }];
    expect(archivePathOf(a, tomb)).toBe("/from/tombstone");
    expect(archivePathOf(a, [])).toBe("/from/recipe");
    expect(archivePathOf(a, undefined)).toBe("/from/recipe");
  });
  test("deleted repositories newest first", () => {
    const rows = [{ id: "a", deletedAt: "2026-01-01" }, { id: "b", deletedAt: "2026-02-01" }] as DeletedRepository[];
    expect(sortDeleted(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("formatBytes", () => {
  test("human sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1234)).toBe("1.2 kB");
    expect(formatBytes(45_600_000)).toBe("46 MB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
  });
});

describe("settings updates", () => {
  const view: SettingsView = {
    hosts: [],
    forges: [{ host: "forge.example", kind: "github", requestReserve: 1500, tokenCommand: "gh auth token", owners: ["acme"] }],
    agents: [],
    staleDays: 60,
    worktreeDir: "~/wt",
    dailyScanTime: "03:00",
    archiveDir: "~/archives",
    jev: { apiKeySet: true, source: "settings", apiKeyCommand: "secret-tool lookup x" },
  };
  test("ordinary saves never send jev, so the stored key stays", () => {
    const u = settingsUpdate(view, { staleDays: 30 });
    expect("jev" in u).toBe(false);
    expect(u.staleDays).toBe(30);
    expect(u.archiveDir).toBe("~/archives");
  });
  test("key changes send only the given jev fields", () => {
    expect(settingsUpdate(view, {}, { apiKey: "k" }).jev).toEqual({ apiKey: "k" });
    expect(settingsUpdate(view, {}, { apiKey: null }).jev).toEqual({ apiKey: null });
    expect(settingsUpdate(view, {}, { apiKeyCommand: null }).jev).toEqual({ apiKeyCommand: null });
  });
  test("owners are trimmed and deduplicated case-insensitively", () => {
    expect(cleanOwners([" acme ", "", "@Wooden", "ACME", "wooden"])).toEqual(["acme", "Wooden"]);
  });
  test("editing a forge keeps fields the form does not edit", () => {
    const f = editedForge(view.forges[0], { host: " Forge.Example ", kind: "github", source: "env", token: "TOKEN_VAR", owners: ["acme", "org"] });
    expect(f).toEqual({ host: "forge.example", kind: "github", requestReserve: 1500, tokenEnv: "TOKEN_VAR", owners: ["acme", "org"] });
    expect(editedForge(view.forges[0], { host: "forge.example", kind: "github", source: "command", token: "", owners: [""] })).toEqual({ host: "forge.example", kind: "github", requestReserve: 1500 });
    expect(editedForge(null, { host: "x.example", kind: "forgejo", source: "command", token: "cmd", owners: [] })).toEqual({ host: "x.example", kind: "forgejo", tokenCommand: "cmd" });
  });
});

describe("visibility filters", () => {
  test("server input", () => {
    expect(visibilityInput({ owner: "all", muted: false })).toEqual({});
    expect(visibilityInput({ owner: "mine", muted: false })).toEqual({ mine: true });
    expect(visibilityInput({ owner: "others", muted: true })).toEqual({ mine: false, includeMuted: true });
  });
  test("URL round trip and defaults", () => {
    for (const schema of [repoListSearch, branchSearch, worktreeSearch, prListSearch]) {
      expect(schema.decode({}).owner).toBe("all");
      expect(schema.decode({}).muted).toBe(false);
      expect(schema.decode({ owner: "others", muted: "true" })).toMatchObject({ owner: "others", muted: true });
      expect(schema.decode({ owner: "nobody" }).owner).toBe("all");
    }
    expect(repoListSearch.strip(repoListSearch.decode({ muted: true, owner: "all" }))).toEqual({ muted: true });
    expect(repoListSearch.activeCount(repoListSearch.decode({ owner: "mine", muted: true }), REPO_FILTER_KEYS)).toBe(2);
    expect(repoListSearch.decode({ view: "deleted" }).view).toBe("deleted");
  });
});

describe("optimistic mute", () => {
  const repo = (key: string, muted = false): RepositorySummary => ({ id: key, key, name: key, clones: 1, branches: 0, about: null, owner: "acme", mine: true, muted });
  test("hides the row from lists without muted repositories, flags it elsewhere", () => {
    const client = new QueryClient();
    const page = (items: RepositorySummary[]): Page<RepositorySummary> => ({ items, total: items.length, page: 1, pageSize: 200 });
    client.setQueryData(["inv", "repos", { pageSize: 200 }], page([repo("a"), repo("b")]));
    client.setQueryData(["inv", "repos", { pageSize: 200, includeMuted: true }], page([repo("a"), repo("b")]));
    client.setQueryData(["inv", "repo", "a"], { key: "a", clones: [], branches: [], about: null, owner: "acme", mine: true, muted: false });
    applyMuted(client, "a", true);
    const hidden = client.getQueryData<Page<RepositorySummary>>(["inv", "repos", { pageSize: 200 }])!;
    expect(hidden.items.map((r) => r.key)).toEqual(["b"]);
    expect(hidden.total).toBe(1);
    const shown = client.getQueryData<Page<RepositorySummary>>(["inv", "repos", { pageSize: 200, includeMuted: true }])!;
    expect(shown.items.find((r) => r.key === "a")?.muted).toBe(true);
    expect(client.getQueryData<{ muted: boolean }>(["inv", "repo", "a"])?.muted).toBe(true);
    applyMuted(client, "a", false);
    expect(client.getQueryData<Page<RepositorySummary>>(["inv", "repos", { pageSize: 200, includeMuted: true }])!.items.find((r) => r.key === "a")?.muted).toBe(false);
  });
});

describe("toasts", () => {
  test("keeps the three newest and dismisses by id", () => {
    for (const t of currentToasts()) dismissToast(t.id);
    const ids = ["one", "two", "three", "four"].map((t) => toast(t, { duration: 60_000 }));
    expect(currentToasts().map((t) => t.text)).toEqual(["two", "three", "four"]);
    dismissToast(ids[2]);
    expect(currentToasts().map((t) => t.text)).toEqual(["two", "four"]);
  });
});
