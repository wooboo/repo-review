import { describe, expect, test } from "bun:test";
import type { BranchHistoryItem, LandedVia } from "./api/types";
import { anyLanding, branchLanding, commitsToReview, commitUrl, landingBranches, matchHistory, sameSha, settled } from "./provenance";
import { clonePathOf, canFastForward, canPrune, canPush, canSwitchToBase, countWorktrees, hasChanges, isMissing, worktreeStatus } from "./worktrees";

const landed = (over: Partial<LandedVia> = {}): LandedVia => ({
  pullRequestId: "github.com/o/r!12",
  number: 12,
  url: "https://github.com/o/r/pull/12",
  method: "squash",
  mergeCommitSha: "aaaaaaa1111111111111111111111111111111111",
  matchedSha: "bbbbbbb2222222222222222222222222222222222",
  extraCommits: 0,
  extraCommitShas: [],
  ...over,
});

describe("provenance", () => {
  test("SHA prefixes match", () => {
    expect(sameSha("abc1234", "abc1234def")).toBe(true);
    expect(sameSha("abc1234def", "abc1234")).toBe(true);
    expect(sameSha("abc1234", "abd1234")).toBe(false);
    expect(sameSha("", "abc")).toBe(false);
  });

  test("branch-level landing: the server's, else the PR every clone agrees on", () => {
    const one = landed();
    expect(branchLanding({ landedVia: one, clones: [] })).toBe(one);
    const extra = landed({ extraCommits: 2 });
    expect(branchLanding({ clones: [{ state: "pr-merged-changed", landedVia: one }, { state: "pr-merged-changed", landedVia: extra }] as never })).toBe(extra);
    expect(branchLanding({ clones: [{ landedVia: one }, { landedVia: null }] as never })).toBeNull();
    expect(branchLanding({ clones: [{ landedVia: one }, { landedVia: landed({ pullRequestId: "x!1", number: 1 }) }] as never })).toBeNull();
    expect(branchLanding({ clones: [{}] as never })).toBeNull();
    expect(branchLanding({ clones: [] })).toBeNull();
    // Badges still show something when clones disagree.
    expect(anyLanding({ clones: [{ landedVia: null }, { landedVia: one }] as never })).toBe(one);
    // Base branches absorb every PR; no badge there.
    expect(branchLanding({ verdict: "base", landedVia: one, clones: [] })).toBeNull();
    expect(anyLanding({ verdict: "base", clones: [{ landedVia: one }] as never })).toBeNull();
  });

  test("only the commits after the PR are left to review", () => {
    const commits = [
      "c3c3c3c 2026-10-03T10:00:00Z Fix after review",
      "c2c2c2c 2026-10-02T10:00:00Z Tweak",
      "c1c1c1c 2026-10-01T10:00:00Z Original work",
    ];
    expect(commitsToReview({ commits, state: "pr-merged-changed", landedVia: null })).toMatchObject({ filtered: false, landed: null });
    expect(commitsToReview({ commits, state: "pr-merged-changed", landedVia: null }).commits).toHaveLength(3);
    expect(commitsToReview({ commits, state: "pr-merged-changed", landedVia: landed() })).toMatchObject({ commits: [], filtered: true });
    const byShas = commitsToReview({ commits, state: "pr-merged-changed", landedVia: landed({ extraCommits: 2, extraCommitShas: ["c3c3c3c999", "c2c2c2c999"] }) });
    expect(byShas.commits.map((c) => c.subject)).toEqual(["Fix after review", "Tweak"]);
    // Unmatched SHAs (list truncated or rewritten): the newest K commits.
    const byCount = commitsToReview({ commits, state: "pr-merged-changed", landedVia: landed({ extraCommits: 1, extraCommitShas: ["ffffff"] }) });
    expect(byCount.commits.map((c) => c.sha)).toEqual(["c3c3c3c"]);
  });

  test("extra commits on an integrated branch are settled, not shown for review", () => {
    const extra = landed({ extraCommits: 1, extraCommitShas: ["c3c3c3c"] });
    expect(settled(extra, false)).toBe(extra);
    expect(settled(extra, true)).toMatchObject({ number: 12, extraCommits: 0, extraCommitShas: [] });
    expect(settled(null, true)).toBeNull();
    expect(commitsToReview({ commits: ["c3c3c3c 2026-10-03T10:00:00Z Fix"], state: "merged", landedVia: extra })).toMatchObject({ commits: [], filtered: true, landed: { extraCommits: 0 } });
    // A deletable branch shows "landed via", not "+1 after".
    expect(branchLanding({ verdict: "delete", landedVia: extra, clones: [] })?.extraCommits).toBe(0);
    expect(anyLanding({ verdict: "delete", clones: [{ state: "merged", landedVia: extra }] as never })?.extraCommits).toBe(0);
    expect(branchLanding({ verdict: "pr-merged-changed", landedVia: extra, clones: [] })?.extraCommits).toBe(1);
  });

  test("landing branches: live first, names from ids", () => {
    const links = landingBranches({ branchIds: ["r#zeta", "r#feat/a#b", "r#alpha"] }, new Set(["r#zeta"]));
    expect(links).toEqual([
      { id: "r#zeta", name: "zeta", live: true },
      { id: "r#alpha", name: "alpha", live: false },
      { id: "r#feat/a#b", name: "feat/a#b", live: false },
    ]);
    expect(landingBranches({ branchIds: ["r#main", "r#feat"] }, new Set(["r#main", "r#feat"]), new Set(["r#main"])).map((b) => b.name)).toEqual(["feat"]);
  });

  test("commit URLs only for forge repositories", () => {
    expect(commitUrl("github.com/o/r", "abc")).toBe("https://github.com/o/r/commit/abc");
    expect(commitUrl("forge.example/o/r", "abc")).toBe("https://forge.example/o/r/commit/abc");
    expect(commitUrl("local/thing@abc", "abc")).toBeNull();
    expect(commitUrl("file:/srv/repo", "abc")).toBeNull();
    expect(commitUrl("github.com/o/r", null)).toBeNull();
  });

  test("history text match", () => {
    const h: BranchHistoryItem = { host: "local", repo: "github.com/o/r", clonePath: "/w/r", branch: "feat/login", sha: "abc1234", firstSeen: "", lastSeen: "", goneAt: null, landedVia: landed() };
    expect(matchHistory(h, "")).toBe(true);
    expect(matchHistory(h, "LOGIN")).toBe(true);
    expect(matchHistory(h, "#12")).toBe(true);
    expect(matchHistory(h, "abc12")).toBe(true);
    expect(matchHistory(h, "other")).toBe(false);
  });
});

describe("worktrees: missing is not dirty", () => {
  const w = (over: Record<string, unknown> = {}) => ({ main: false, exists: true, dirty: false, locked: false, branch: "feat", operations: [] as string[], ...over });
  test("missing derives from exists, even when the collector says dirty", () => {
    const gone = w({ exists: false, dirty: true });
    expect(isMissing(gone)).toBe(true);
    expect(hasChanges(gone)).toBe(false);
    expect(worktreeStatus(gone)).toBe("missing");
    expect(worktreeStatus(w({ dirty: true }))).toBe("changes");
    expect(worktreeStatus(w())).toBe("clean");
  });
  test("counts split changes and missing", () => {
    expect(countWorktrees([w({ dirty: true }), w({ exists: false, dirty: true }), w({ exists: false }), w()])).toEqual({ changes: 1, missing: 2, clean: 1 });
  });
  test("action candidates", () => {
    expect(canSwitchToBase(w({ main: true }), "delete")).toBe(true);
    expect(canSwitchToBase(w({ main: true }), "check")).toBe(true);
    expect(canSwitchToBase(w({ main: true }), "unmerged")).toBe(false);
    expect(canSwitchToBase(w({ main: true, dirty: true }), "delete")).toBe(false);
    expect(canSwitchToBase(w({ main: false }), "delete")).toBe(false);
    expect(canSwitchToBase(w({ main: true, branch: null }), "delete")).toBe(false);
    expect(canSwitchToBase(w({ main: true }), undefined)).toBe(false);
    expect(canPrune(w({ exists: false }))).toBe(true);
    expect(canPrune(w({ exists: false, locked: true }))).toBe(false);
    expect(canPrune(w({ exists: false, main: true }))).toBe(false);
    expect(canPrune(w())).toBe(false);
    expect(canFastForward({ name: "main", state: "base", base: "origin/main", ahead: 0, behind: 3 })).toBe(true);
    expect(canFastForward({ name: "main", state: "base", base: "origin/main", ahead: 1, behind: 3 })).toBe(false);
    expect(canFastForward({ name: "main", state: "base", base: "origin/main", ahead: 0, behind: 0 })).toBe(false);
    expect(canFastForward({ name: "feat", state: "unmerged", base: "origin/main", ahead: 0, behind: 3 })).toBe(false);
    expect(canPush({ state: "unmerged", unpushed: 2 })).toBe(true);
    expect(canPush({ state: "base", unpushed: 2 })).toBe(false);
    expect(canPush({ state: "merged", unpushed: 0 })).toBe(false);
  });
  test("clone path of a worktree", () => {
    const clones = [
      { host: "a", path: "/w/r", worktrees: [{ path: "/w/r" }, { path: "/wt/r-feat" }] },
      { host: "b", path: "/w/r", worktrees: [{ path: "/w/r" }] },
      { host: "a", path: "/w/r2", worktrees: [{ path: "/w/r2" }, { path: "/wt/r2-x" }] },
    ];
    expect(clonePathOf(clones, "a", "/wt/r-feat")).toBe("/w/r");
    expect(clonePathOf(clones, "a", "/wt/r2-x")).toBe("/w/r2");
    expect(clonePathOf(clones, "b", "/wt/r-feat")).toBeNull();
  });
});
