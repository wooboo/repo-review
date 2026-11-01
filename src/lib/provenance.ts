/** View helpers for Contract v3 pull-request provenance (landings, "landed via", branch history). */
import { parseBranchId } from "@/lib/api/ids";
import type { BranchClone, BranchGroup, BranchHistoryItem, LandedVia, Landing } from "@/lib/api/types";
import { parseCommit } from "@/lib/format";

/** Short and full SHAs refer to the same commit when one is a prefix of the other. */
export const sameSha = (a: string, b: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

type Landable = Pick<BranchGroup, "landedVia" | "clones"> & { verdict?: BranchGroup["verdict"] };

/**
 * Branch-level provenance: the server's value when it sends one, otherwise the PR every clone
 * landed through (the clone with the most extra commits wins, so nothing to review is hidden).
 * Base branches absorb every PR, so they never show one.
 */
export function branchLanding(b: Landable): LandedVia | null {
  if (b.verdict === "base") return null;
  if (b.landedVia) return b.landedVia;
  const per = b.clones.map((c) => c.landedVia ?? null);
  if (!per.length || per.some((l) => !l)) return null;
  const all = per as LandedVia[];
  if (!all.every((l) => l.pullRequestId === all[0].pullRequestId)) return null;
  return all.reduce((a, l) => (l.extraCommits > a.extraCommits ? l : a));
}

/** Any clone's provenance, for badges when clones disagree. */
export const anyLanding = (b: Landable): LandedVia | null =>
  b.verdict === "base" ? null : (branchLanding(b) ?? b.clones.find((c) => c.landedVia)?.landedVia ?? null);

export type CommitLine = ReturnType<typeof parseCommit>;

/**
 * The commits a clone's reviewer still has to look at. Without provenance that is every own
 * commit; after a merged PR only the ones added after it (`extraCommitShas`). The collector lists
 * at most 25 commits newest first, so when the SHAs cannot be matched the newest K are shown.
 */
export function commitsToReview(clone: Pick<BranchClone, "commits" | "landedVia">): { commits: CommitLine[]; filtered: boolean } {
  const all = clone.commits.map(parseCommit);
  const lv = clone.landedVia;
  if (!lv) return { commits: all, filtered: false };
  if (lv.extraCommits <= 0) return { commits: [], filtered: true };
  const matched = all.filter((c) => lv.extraCommitShas.some((s) => sameSha(c.sha, s)));
  return { commits: matched.length ? matched : all.slice(0, lv.extraCommits), filtered: true };
}

export type BranchLink = { id: string; name: string; live: boolean };

/** Local branches that landed in a base commit, live ones first, with their display name. */
export function landingBranches(landing: Pick<Landing, "branchIds">, liveIds: ReadonlySet<string>): BranchLink[] {
  return landing.branchIds
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
