/** Worktree status and the actions a worktree or branch clone qualifies for. */
import type { BranchInfo, Verdict, Worktree } from "@/lib/api/types";

/** TODO(contract-v3): the backend sends `missing`; older servers only report `exists === false` (and mark it dirty). */
export const isMissing = (w: Pick<Worktree, "exists" | "missing">) => w.missing ?? !w.exists;
/** Real uncommitted changes; a missing directory is never "dirty". */
export const hasChanges = (w: Pick<Worktree, "exists" | "missing" | "dirty">) => !isMissing(w) && w.dirty;

export type WorktreeStatus = "changes" | "missing" | "clean";
export const WORKTREE_STATUSES: readonly WorktreeStatus[] = ["changes", "missing", "clean"];
export const worktreeStatus = (w: Pick<Worktree, "exists" | "missing" | "dirty">): WorktreeStatus => (isMissing(w) ? "missing" : w.dirty ? "changes" : "clean");

export function countWorktrees(rows: readonly Pick<Worktree, "exists" | "missing" | "dirty">[]): Record<WorktreeStatus, number> {
  const out: Record<WorktreeStatus, number> = { changes: 0, missing: 0, clean: 0 };
  for (const w of rows) out[worktreeStatus(w)]++;
  return out;
}

const INTEGRATED: ReadonlySet<Verdict> = new Set(["delete", "check"]);

/** A main checkout standing on an integrated (non-base) branch can switch back to its base. */
export const canSwitchToBase = (w: Pick<Worktree, "main" | "exists" | "missing" | "dirty" | "branch" | "operations">, verdict: Verdict | undefined) =>
  w.main && !!w.branch && !isMissing(w) && !w.dirty && !w.operations.length && verdict !== undefined && INTEGRATED.has(verdict);

/** A registered worktree whose directory is gone can have its entry pruned. */
export const canPrune = (w: Pick<Worktree, "main" | "exists" | "missing" | "locked">) => !w.main && !w.locked && isMissing(w);

/** A local base branch that is only behind its remote base can be fast-forwarded. */
export const canFastForward = (b: Pick<BranchInfo, "state" | "base" | "ahead" | "behind" | "name">) =>
  b.state === "base" && !!b.base && b.base !== b.name && b.ahead === 0 && b.behind > 0;

/** Commits that exist on no remote can be pushed. */
export const canPush = (b: Pick<BranchInfo, "state" | "unpushed">) => b.state !== "base" && b.unpushed > 0;

/** Clone path (the action target's `repo`) of a worktree, from the repository detail. */
export function clonePathOf(clones: readonly { host: string; path: string; worktrees: readonly { path: string }[] }[], host: string, worktreePath: string): string | null {
  return clones.find((c) => c.host === host && (c.path === worktreePath || c.worktrees.some((w) => w.path === worktreePath)))?.path ?? null;
}
