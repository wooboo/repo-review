/** View helpers for Contract v3 pull-request provenance (landings, "landed via", branch history). */
import { parseBranchId } from "@/lib/api/ids";
import type { BranchClone, BranchGroup, BranchHistoryItem, LandedVia, Landing } from "@/lib/api/types";
import { parseCommit } from "@/lib/format";

/** Short and full SHAs refer to the same commit when one is a prefix of the other. */
export const sameSha = (a: string, b: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

type Landable = Pick<BranchGroup, "clones"> & Partial<Pick<BranchGroup, "landedVia" | "verdict">>;

const INTEGRATED_STATES: ReadonlySet<string> = new Set(["merged", "patch-merged", "squash-merged", "content-in-base", "pr-merged"]);

/**
 * Commits added after a merged PR only need review while they are not in the base yet: once the
 * branch is integrated anyway (e.g. merged again later), the PR landed it and nothing is left.
 */
export function settled(lv: LandedVia | null | undefined, integrated: boolean): LandedVia | null {
  if (!lv) return null;
  return integrated && lv.extraCommits > 0 ? { ...lv, extraCommits: 0, extraCommitShas: [] } : lv;
}
const branchIntegrated = (b: Landable) => b.verdict === "delete" || b.verdict === "check";

/**
 * Branch-level provenance: the server's value when it sends one, otherwise the PR every clone
 * landed through (the clone with the most extra commits wins, so nothing to review is hidden).
 * Base branches absorb every PR, so they never show one.
 */
export function branchLanding(b: Landable): LandedVia | null {
  if (b.verdict === "base") return null;
  if (b.landedVia) return settled(b.landedVia, branchIntegrated(b));
  const per = b.clones.map((c) => settled(c.landedVia, branchIntegrated(b) || INTEGRATED_STATES.has(c.state)));
  if (!per.length || per.some((l) => !l)) return null;
  const all = per as LandedVia[];
  if (!all.every((l) => l.pullRequestId === all[0].pullRequestId)) return null;
  return all.reduce((a, l) => (l.extraCommits > a.extraCommits ? l : a));
}

/** Any clone's provenance, for badges when clones disagree. */
export const anyLanding = (b: Landable): LandedVia | null =>
  b.verdict === "base" ? null : (branchLanding(b) ?? settled(b.clones.find((c) => c.landedVia)?.landedVia, branchIntegrated(b)));

export type CommitLine = ReturnType<typeof parseCommit>;

/**
 * The commits a clone's reviewer still has to look at. Without provenance that is every own
 * commit; after a merged PR only the ones added after it (`extraCommitShas`). The collector lists
 * at most 25 commits newest first, so when the SHAs cannot be matched the newest K are shown.
 */
export function commitsToReview(clone: Pick<BranchClone, "commits" | "landedVia" | "state">): { commits: CommitLine[]; filtered: boolean; landed: LandedVia | null } {
  const all = clone.commits.map(parseCommit);
  const lv = settled(clone.landedVia, INTEGRATED_STATES.has(clone.state));
  if (!lv) return { commits: all, filtered: false, landed: null };
  if (lv.extraCommits <= 0) return { commits: [], filtered: true, landed: lv };
  const matched = all.filter((c) => lv.extraCommitShas.some((s) => sameSha(c.sha, s)));
  return { commits: matched.length ? matched : all.slice(0, lv.extraCommits), filtered: true, landed: lv };
}

export type BranchLink = { id: string; name: string; live: boolean };

/**
 * Local branches that landed in a base commit, live ones first, with their display name. Base
 * branches (`skip`) contain every landing, so they are left out.
 */
export function landingBranches(landing: Pick<Landing, "branchIds">, liveIds: ReadonlySet<string>, skip: ReadonlySet<string> = new Set()): BranchLink[] {
  return landing.branchIds
    .filter((id) => !skip.has(id))
    .map((id) => ({ id, name: parseBranchId(id)?.name ?? id, live: liveIds.has(id) }))
    .sort((a, b) => Number(b.live) - Number(a.live) || a.name.localeCompare(b.name));
}

/** Forge web URL of a commit; null for repositories without a forge (local/…, file:…). */
export function commitUrl(repo: string, sha: string | null | undefined): string | null {
  if (!sha || repo.startsWith("local/") || repo.startsWith("file:")) return null;
  return `https://${repo}/commit/${sha}`;
}

/** Client-side text match for the branch history page (the server list has no text filter). */
export function matchHistory(item: BranchHistoryItem, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  return [item.branch, item.repo, item.clonePath, item.host, item.sha, item.landedVia ? `#${item.landedVia.number}` : ""].some((v) => v.toLowerCase().includes(t));
}
