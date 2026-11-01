/** Pure helpers of the repository deletion flow (docs/API.md, Contract v4). */
import type { CloneDeletionSummary, DeletedRepository, PlannedAction, RepositoryDeletionPlan } from "@/lib/api/types";

/**
 * The typed name must equal the repository's display name exactly (the server compares it
 * verbatim); surrounding whitespace from phone keyboards is ignored and not sent.
 */
export const confirmMatches = (typed: string, name: string) => name !== "" && typed.trim() === name;

/** What applying the reviewed plan would do. */
export function deletionScope(plan: RepositoryDeletionPlan) {
  const runnable = plan.actions.filter((a) => a.kind === "delete-clone" && a.status === "planned");
  const blocked = plan.summary.clones.length - runnable.length;
  return {
    ids: runnable.map((a) => a.id),
    blocked,
    /** Whole-repository purge happens only when every clone goes, so a blocked clone prevents it. */
    purges: plan.summary.purgesRepository && blocked === 0 && runnable.length > 0,
  };
}

/** The planned action of one clone summary. */
export const actionOf = (actions: readonly PlannedAction[], clone: CloneDeletionSummary) => actions.find((a) => a.id === clone.actionId);

/** Can this clone be deleted as planned? Blocked when the planner refused it or reported blockers. */
export const cloneBlocked = (clone: CloneDeletionSummary, action: PlannedAction | undefined) => !action || action.status !== "planned" || clone.blockers.length > 0;

/** Single-quoted shell word (as the worker writes it) → its value. */
function unquote(word: string): string {
  return word.replace(/^'|'$/g, "").replaceAll("'\\''", "'");
}

/**
 * Archive directory from a delete-clone restore recipe, which starts with
 * `git clone '<archive>/repo.bundle' '<clone path>'`. Null when the recipe has another shape.
 */
export function archivePathFromRestore(restore: string | null | undefined): string | null {
  const match = restore?.match(/^git clone ('(?:[^']|'\\'')*')/);
  if (!match) return null;
  const bundle = unquote(match[1]);
  return bundle.endsWith("/repo.bundle") ? bundle.slice(0, -"/repo.bundle".length) : null;
}

/** Archive of a deleted clone: the tombstone's record first, else the restore recipe. */
export function archivePathOf(action: PlannedAction, tombstones: readonly DeletedRepository[] | undefined): string | null {
  const recorded = tombstones
    ?.filter((t) => t.id === action.repoKey)
    .flatMap((t) => t.clones)
    .filter((c) => c.host === action.target.host && c.path === action.target.repo)
    .at(-1)?.archivePath;
  return recorded ?? archivePathFromRestore(action.restore);
}

/** The server rejects a mismatched name with a typed error before starting any work. */
export function isDeletionConfirmationError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const tagged = e as { _tag?: unknown; name?: unknown; message?: unknown };
  return tagged._tag === "DeletionConfirmationError" || tagged.name === "DeletionConfirmationError" || (typeof tagged.message === "string" && tagged.message.includes("Confirmation must equal the repository display name"));
}

/** Newest deletion first. */
export const sortDeleted = (rows: readonly DeletedRepository[]) => [...rows].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
