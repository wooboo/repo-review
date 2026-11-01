import { Link } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ChecksBadge, DivergenceBar, FlagChips, Mono, Pill, PrStateBadge, RelativeTime, ReviewBadge, ShaChips, VerdictBadge } from "@/components/domain";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { BranchGroup, PullRequest, WorktreeItem } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

/** The clone that best represents a grouped branch: the one furthest ahead of its base. */
export const leadClone = (b: BranchGroup) => [...b.clones].sort((x, y) => y.ahead - x.ahead || y.behind - x.behind)[0];
export const divergenceMax = (rows: readonly BranchGroup[]) => Math.max(10, ...rows.flatMap((b) => b.clones.flatMap((c) => [c.ahead, c.behind])));

/** Pull requests by branch id (from the PR cache); empty when no forge is configured. */
export function usePrsByBranch(repo?: string) {
  const prs = useQuery(q.prs({ state: "all", repo, page: 1, pageSize: 100_000 }));
  return useMemo(() => {
    const map = new Map<string, PullRequest>();
    for (const p of prs.data?.items ?? []) if (p.branchId && (!map.has(p.branchId) || p.state === "open")) map.set(p.branchId, p);
    return map;
  }, [prs.data]);
}

export function BranchRow({ branch, max, showRepo = true, pr }: { branch: BranchGroup; max: number; showRepo?: boolean; pr?: PullRequest }) {
  const lead = leadClone(branch);
  return (
    <li>
      <Link to="/branches/$id" params={{ id: branch.id }} className="flex flex-col gap-1.5 p-3 hover:bg-muted/50">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium break-all">{branch.name}</span>
          <VerdictBadge verdict={branch.verdict} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showRepo && <span className="font-medium text-foreground/80 break-all">{repoName(branch.repo)}</span>}
          <RelativeTime iso={branch.date} />
          {lead.subject && <span className="line-clamp-1 min-w-0 basis-full break-all sm:basis-auto sm:flex-1">{lead.subject}</span>}
        </span>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <ShaChips clones={branch.clones} />
          <DivergenceBar behind={lead.behind} ahead={lead.ahead} base={lead.base} max={max} />
        </span>
        {(pr || branch.stale || branch.dirty || branch.localOnly || branch.differentShas || branch.clones.some((c) => c.upstreamGone || c.containedIn.length)) && (
          <span className="flex flex-wrap gap-1">
            {pr && <PrStateBadge pr={pr} />}
            <FlagChips branch={branch} />
          </span>
        )}
      </Link>
    </li>
  );
}

export function PrRow({ pr, showRepo = true }: { pr: PullRequest; showRepo?: boolean }) {
  return (
    <li>
      <Link to="/prs/$pr" params={{ pr: pr.id }} className="flex flex-col gap-1.5 p-3 hover:bg-muted/50">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium break-words">{pr.title}</span>
          <PrStateBadge pr={pr} />
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showRepo && <span className="font-medium text-foreground/80 break-all">{repoName(pr.repo)}</span>}
          <span className="break-all">{pr.head} → {pr.base}</span>
          <span>{m.prs.by(pr.author)}</span>
          <RelativeTime iso={pr.updatedAt} />
        </span>
        {(pr.checks.state !== "none" || pr.review !== "none") && (
          <span className="flex flex-wrap gap-1">
            <ChecksBadge checks={pr.checks} />
            <ReviewBadge review={pr.review} />
          </span>
        )}
      </Link>
    </li>
  );
}

const xyLabel = (xy: string) => (xy === "??" ? "new" : xy.replace(/\./g, " ").trim() || xy);

export function WorktreeCard({ worktree: w, showRepo = true }: { worktree: WorktreeItem; showRepo?: boolean }) {
  const counts = m.worktrees.counts(w.staged, w.unstaged, w.untracked, w.conflicts);
  const hasFiles = w.files.length > 0;
  return (
    <Collapsible className={cn("rounded-xl border bg-card", !w.exists && "border-destructive/40")}>
      <CollapsibleTrigger asChild disabled={!hasFiles}>
        <button type="button" className="group flex w-full items-start gap-2 p-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {showRepo && <span className="font-medium break-all">{repoName(w.repo)}</span>}
              {w.branch ? (
                <span className="font-mono text-sm break-all">{w.branch}</span>
              ) : (
                <Pill>{m.worktrees.detached}</Pill>
              )}
            </span>
            <Mono className="text-muted-foreground">{w.host}:{w.path}</Mono>
            <span className="flex flex-wrap items-center gap-1">
              {!w.exists && <Pill t="bad">{m.worktrees.missing}</Pill>}
              {w.main && <Pill>{m.worktrees.main}</Pill>}
              {w.locked && <Pill t="warn">{m.worktrees.locked}</Pill>}
              {w.prunable && <Pill t="warn">{m.worktrees.prunable}</Pill>}
              {w.operations.map((o) => (
                <Pill key={o} t="bad">{o}</Pill>
              ))}
              {w.dirty && <Pill t="warn">{counts || m.flag.dirty}</Pill>}
              {w.error && <Pill t="bad" title={w.error}>{m.somethingWrong}</Pill>}
            </span>
          </span>
          {hasFiles && <ChevronDownIcon aria-label={m.worktrees.files(w.total || w.files.length)} className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />}
        </button>
      </CollapsibleTrigger>
      {hasFiles && (
        <CollapsibleContent>
          <ul className="flex flex-col border-t py-1 font-mono text-xs">
            {w.files.map((f) => (
              <li key={f.path} className="flex items-baseline gap-2 px-3 py-1">
                <span className={cn("w-8 shrink-0", f.xy === "??" ? "text-success" : f.xy.includes("D") ? "text-destructive" : "text-warning")}>{xyLabel(f.xy)}</span>
                <span className="min-w-0 flex-1 break-all">{f.path}</span>
                {f.mtime && <RelativeTime iso={f.mtime} className="shrink-0 font-sans text-muted-foreground" />}
              </li>
            ))}
          </ul>
          {w.total > w.files.length && <p className="px-3 pb-2 text-xs text-muted-foreground">{m.worktrees.filesTruncated(w.files.length, w.total)}</p>}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn("flex flex-col divide-y rounded-xl border bg-card", className)}>{children}</ul>;
}
