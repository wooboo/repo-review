/** Pure formatting helpers (English, Intl). */
import { m } from "@/messages";
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30.44 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago", "yesterday", "in 2 hours"; empty for missing or invalid dates. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const seconds = (t - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return m.time.justNow;
  for (const [unit, size] of units) if (abs >= size || unit === "minute") return rtf.format(Math.round(seconds / size), unit);
  return "";
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? dateFmt.format(new Date(iso)) : "");
export const formatDateTime = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? dateTimeFmt.format(new Date(iso)) : "");

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}m ${s % 60}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export const shortSha = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "");
export const formatCost = (usd: number | null) => (usd === null ? "" : new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd));
export const formatCount = (n: number) => n.toLocaleString("en");

/**
 * Width in px of one side of a divergence bar: logarithmic so 3 and 3000 commits both read,
 * at least `min` px for any non-zero count, `width` px at the largest count in view.
 */
export function divergenceWidth(n: number, max: number, width = 48, min = 3): number {
  if (n <= 0) return 0;
  const top = Math.max(max, n, 1);
  return Math.max(min, Math.round((width * Math.log10(1 + n)) / Math.log10(1 + top)));
}

/** `%h %aI %s` lines from the collector. */
export function parseCommit(line: string): { sha: string; date: string; subject: string } {
  const [sha = "", date = "", ...rest] = line.split(" ");
  return { sha, date, subject: rest.join(" ") };
}

/** `%gd %H %cI %gs` stash lines from the collector. */
export function parseStash(line: string): { ref: string; sha: string; date: string; subject: string } {
  const [ref = "", sha = "", date = "", ...rest] = line.split(" ");
  return { ref, sha, date, subject: rest.join(" ") };
}

/** `git diff --shortstat` → numbers; null when empty. */
export function parseShortstat(s: string): { files: number; insertions: number; deletions: number } | null {
  if (!s.trim()) return null;
  const n = (re: RegExp) => Number(re.exec(s)?.[1] ?? 0);
  return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?\(\+\)/), deletions: n(/(\d+) deletions?\(-\)/) };
}

/**
 * One-line summary of a repository from the collector's "about" material: the first prose
 * paragraph of the README, without markdown decoration. Used until AI descriptions exist.
 */
export function readmeSummary(about: string, max = 160): string {
  let readme = "";
  try {
    const parsed: unknown = JSON.parse(about);
    if (parsed && typeof parsed === "object" && "readme" in parsed && typeof parsed.readme === "string") readme = parsed.readme;
  } catch {
    return "";
  }
  const text = readme.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "");
  for (const block of text.split(/\n\s*\n/)) {
    const line = block
      .split("\n")
      .map((l) => l.trim())
      .join(" ")
      .trim();
    if (!line || /^(#|!\[|\[!\[|<|\||-{3,}|={3,}|>\s*\[!)/.test(line)) continue;
    const clean = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .replace(/^>\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length < 12) continue;
    return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
  }
  return "";
}

/** "origin/main" → "main" for forge APIs. */
export const stripRemote = (ref: string | null | undefined) => (ref ? ref.replace(/^[^/]+\//, "") : "");

export const repoName = (key: string) => key.split("/").at(-1)?.replace(/@[0-9a-f]+$/, "") ?? key;
export const repoOwner = (key: string) => key.split("/").slice(0, -1).join("/");
