import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import type * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { ActionStatus, AgentRunStatus, BranchClone, State, BranchGroup, ChecksSummary, LandedVia, LandingMethod, PullRequest, ReviewState, ScanStatus, Verdict } from "@/lib/api/types";
import { divergenceWidth, formatDateTime, relativeTime, shortSha } from "@/lib/format";
import { divergingShas, VERDICTS } from "@/lib/verdicts";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export const verdictBg: Record<Verdict, string> = {
  base: "bg-v-base",
  delete: "bg-v-delete",
  check: "bg-v-check",
  "pr-open": "bg-v-pr-open",
  "local-only": "bg-v-local-only",
  "pr-closed": "bg-v-pr-closed",
  "pr-merged-changed": "bg-v-pr-merged-changed",
  unmerged: "bg-v-unmerged",
};

export function Dot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} aria-hidden="true" />;
}

const pill = "inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap";

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(pill, "bg-background", className)}>
          <Dot className={verdictBg[verdict]} />
          {m.verdict[verdict]}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{m.verdictHelp[verdict]}</TooltipContent>
    </Tooltip>
  );
}

export function StateBadge({ state }: { state: State }) {
  const integrated = state === "merged" || state === "patch-merged" || state === "squash-merged" || state === "content-in-base" || state === "pr-merged";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(pill, integrated ? "border-success/40 text-success" : "text-muted-foreground")}>{m.state[state]}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{m.stateHelp[state]}</TooltipContent>
    </Tooltip>
  );
}

type Tone = "neutral" | "good" | "bad" | "warn" | "busy";
const tone: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  good: "border-success/40 text-success",
  bad: "border-destructive/40 text-destructive",
  warn: "border-warning/50 text-warning",
  busy: "border-primary/40 text-primary",
};
export function Pill({ children, t = "neutral", className, title }: { children: React.ReactNode; t?: Tone; className?: string; title?: string }) {
  return (
    <span className={cn(pill, tone[t], className)} title={title}>
      {children}
    </span>
  );
}

const statusTone: Record<ScanStatus | AgentRunStatus | ActionStatus, Tone> = {
  queued: "neutral",
  running: "busy",
  done: "good",
  failed: "bad",
  cancelled: "neutral",
  planned: "busy",
  skipped: "neutral",
  blocked: "warn",
};
export function StatusBadge({ status, label }: { status: ScanStatus | AgentRunStatus | ActionStatus; label: string }) {
  return (
    <Pill t={statusTone[status]}>
      {status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
      {label}
    </Pill>
  );
}

export function ChecksBadge({ checks }: { checks: ChecksSummary }) {
  if (checks.state === "none") return null;
  const t: Tone = checks.state === "success" ? "good" : checks.state === "failure" ? "bad" : "warn";
  return <Pill t={t}>{m.prs.checks[checks.state]}{checks.total ? ` ${checks.total - checks.failed - checks.pending}/${checks.total}` : ""}</Pill>;
}

export function ReviewBadge({ review }: { review: ReviewState }) {
  if (review === "none") return null;
  const t: Tone = review === "approved" ? "good" : review === "changes_requested" ? "bad" : "warn";
  return <Pill t={t}>{m.prs.review[review]}</Pill>;
}

export function PrStateBadge({ pr }: { pr: Pick<PullRequest, "state" | "draft" | "number"> }) {
  const t: Tone = pr.state === "open" ? (pr.draft ? "neutral" : "busy") : pr.state === "merged" ? "good" : "bad";
  return (
    <Pill t={t}>
      #{pr.number} {pr.draft && pr.state === "open" ? m.prs.draft : m.prs.state[pr.state]}
    </Pill>
  );
}

/** Merge method of a merged PR or landing ("squash", "rebase", …); nothing when unknown. */
export function MethodPill({ method }: { method: LandingMethod | "direct" | null | undefined }) {
  if (!method || method === "unknown") return null;
  return <Pill>{m.prs.landedMethod[method]}</Pill>;
}

/** "Landed via #12 · squash", or "+2 after #12" when the branch kept going after its PR merged. */
export function LandedBadge({ landed, className }: { landed: LandedVia; className?: string }) {
  if (landed.extraCommits > 0) return <Pill t="warn" className={className}>{m.provenance.afterShort(landed.extraCommits, landed.number)}</Pill>;
  const method = m.provenance.method[landed.method];
  return (
    <Pill t="good" className={className}>
      {m.provenance.landedVia(landed.number)}
      {method && <span className="font-normal opacity-80">· {method}</span>}
    </Pill>
  );
}

/** Proportional strip of branch verdicts for one repository. */
export function VerdictBar({ counts, className }: { counts: Partial<Record<Verdict, number>>; className?: string }) {
  const total = VERDICTS.reduce((s, v) => s + (counts[v] ?? 0), 0);
  const label = VERDICTS.filter((v) => counts[v]).map((v) => `${m.verdict[v]}: ${counts[v]}`).join(", ");
  if (!total) return <div className={cn("h-2 rounded-full bg-muted", className)} />;
  return (
    <div className={cn("flex h-2 gap-px overflow-hidden rounded-full", className)} role="img" aria-label={label} title={label}>
      {VERDICTS.filter((v) => counts[v]).map((v) => (
        <span key={v} className={verdictBg[v]} style={{ flexGrow: counts[v] }} />
      ))}
    </div>
  );
}

/**
 * Divergence against the base: commits the base has that the branch lacks (−, left) and the
 * branch's own commits (+, right). Log scale so 2 and 2000 both read.
 */
export function DivergenceBar({ behind, ahead, max, base, className }: { behind: number; ahead: number; max: number; base: string | null; className?: string }) {
  if (!base) return <span className="text-xs text-muted-foreground">{m.branches.noBase}</span>;
  const label = m.branches.divergence(base, behind, ahead);
  return (
    <span className={cn("inline-flex w-24 shrink-0 flex-col items-stretch gap-0.5 md:w-36", className)} role="img" aria-label={label} title={label}>
      <span className="flex h-2 items-center">
        <span className="flex flex-1 justify-end">
          <span className="h-2 rounded-l-sm bg-muted-foreground/50" style={{ width: `${divergenceWidth(behind, max, 100, 6)}%` }} />
        </span>
        <span className="h-3 w-px shrink-0 bg-foreground/60" />
        <span className="flex flex-1">
          <span className="h-2 rounded-r-sm bg-primary" style={{ width: `${divergenceWidth(ahead, max, 100, 6)}%` }} />
        </span>
      </span>
      <span className="flex justify-between font-mono text-[10px] leading-none text-muted-foreground tabular-nums">
        <span>−{behind}</span>
        <span>+{ahead}</span>
      </span>
    </span>
  );
}

/** One chip per clone: host and short SHA; SHAs that differ from the majority are highlighted. */
export function ShaChips({ clones, className }: { clones: readonly Pick<BranchClone, "host" | "sha" | "path">[]; className?: string }) {
  const odd = divergingShas(clones.map((c) => c.sha));
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {clones.map((c) => (
        <span
          key={c.host + c.path}
          title={`${c.host}:${c.path}\n${c.sha}`}
          className={cn(
            "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px] whitespace-nowrap",
            odd.has(c.sha) ? "border-warning bg-warning/15 text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="font-sans font-medium">{c.host}</span>
          {shortSha(c.sha)}
        </span>
      ))}
    </span>
  );
}

export function branchFlags(b: BranchGroup): { key: keyof typeof m.flag; t: Tone }[] {
  const flags: { key: keyof typeof m.flag; t: Tone }[] = [];
  if (b.localOnly) flags.push({ key: "localOnly", t: "bad" });
  if (b.dirty) flags.push({ key: "dirty", t: "warn" });
  if (b.differentShas) flags.push({ key: "differentShas", t: "warn" });
  if (b.clones.some((c) => c.upstreamGone)) flags.push({ key: "upstreamGone", t: "neutral" });
  if (b.clones.some((c) => c.containedIn.length > 0)) flags.push({ key: "contained", t: "neutral" });
  if (b.stale) flags.push({ key: "stale", t: "neutral" });
  return flags;
}

export function FlagChips({ branch, extra }: { branch: BranchGroup; extra?: { key: keyof typeof m.flag; t: Tone }[] }) {
  const flags = [...branchFlags(branch), ...(extra ?? [])];
  if (!flags.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Pill key={f.key} t={f.t}>
          {m.flag[f.key]}
        </Pill>
      ))}
    </span>
  );
}

/** Relative time with the full date as a tooltip; recomputed on the client after hydration. */
export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={cn("text-muted-foreground", className)}>{m.time.never}</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className} suppressHydrationWarning>
      {relativeTime(iso)}
    </time>
  );
}

export function CopyButton({ text, label = m.copy, className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("h-11 shrink-0 md:h-7", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {done ? m.copied : label}
    </Button>
  );
}

export function Mono({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("font-mono text-xs break-all", className)} title={title}>
      {children}
    </span>
  );
}

/** Label/value rows for detail cards. */
export function KV({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm", className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
