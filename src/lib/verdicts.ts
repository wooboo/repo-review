import type { BranchGroup, Verdict } from "@/lib/api/types";

/** Most urgent first: the only copy of work, then decisions, then safe clean-ups. */
export const VERDICTS: readonly Verdict[] = ["local-only", "unmerged", "pr-closed", "pr-merged-changed", "check", "pr-open", "delete", "base"];
export const DECIDE: ReadonlySet<Verdict> = new Set(["local-only", "unmerged", "pr-closed", "pr-merged-changed", "check"]);

export const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && (VERDICTS as readonly string[]).includes(v);

export function groupByVerdict<T extends { verdict: Verdict }>(rows: readonly T[]): { verdict: Verdict; items: T[] }[] {
  return VERDICTS.map((verdict) => ({ verdict, items: rows.filter((r) => r.verdict === verdict) })).filter((g) => g.items.length > 0);
}

export function countVerdicts(rows: readonly { verdict: Verdict }[]): Partial<Record<Verdict, number>> {
  const out: Partial<Record<Verdict, number>> = {};
  for (const r of rows) out[r.verdict] = (out[r.verdict] ?? 0) + 1;
  return out;
}

export const needsDecision = (counts: Partial<Record<Verdict, number>>) => [...DECIDE].reduce((s, v) => s + (counts[v] ?? 0), 0);

/** Per-repository verdict counts from a flat branch list. */
export function verdictsByRepo(rows: readonly Pick<BranchGroup, "repo" | "verdict">[]): Map<string, Partial<Record<Verdict, number>>> {
  const map = new Map<string, Partial<Record<Verdict, number>>>();
  for (const r of rows) {
    const c = map.get(r.repo) ?? {};
    c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    map.set(r.repo, c);
  }
  return map;
}

/** SHAs that differ from the most common one across clones; all of them when no SHA is the majority. */
export function divergingShas(shas: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of shas) counts.set(s, (counts.get(s) ?? 0) + 1);
  if (counts.size <= 1) return new Set();
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] === ranked[1][1]) return new Set(counts.keys());
  return new Set(ranked.slice(1).map(([s]) => s));
}
