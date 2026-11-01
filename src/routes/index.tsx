import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRightIcon, Trash2Icon } from "lucide-react";
import { useMemo } from "react";
import { useActionFlow } from "@/components/action-flow";
import { DivergenceBar, RelativeTime, VerdictBadge } from "@/components/domain";
import { Card, PageHeader, Section } from "@/components/page-header";
import { ScanControl, ScanRow, useScans } from "@/components/scans";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { cn } from "@/lib/utils";
import { DECIDE, needsDecision } from "@/lib/verdicts";
import { countWorktrees } from "@/lib/worktrees";
import { m } from "@/messages";

export const Route = createFileRoute("/")({
  head: () => title(m.attention.title),
  loader: ({ context }) => prefetch(context.queryClient, q.dashboard(), q.scans()),
  component: Attention,
});

function Attention() {
  const dashboard = useQuery({ ...q.dashboard(), refetchInterval: (query) => ((query.state.data?.runningScans.length ?? 0) + (query.state.data?.runningAgentRuns ?? 0) > 0 ? 2000 : false) });
  const localOnly = useQuery(q.branches({ verdicts: ["local-only"], sort: "date", pageSize: 5 }));
  const scans = useScans();
  const flow = useActionFlow();
  // TODO(contract-v3): v2's dashboard.dirtyWorktrees also counts missing directories and has no
  // missing count, so both tiles are counted from the worktree list.
  const worktrees = useQuery(q.worktrees({}));
  const wt = useMemo(() => (worktrees.data ? countWorktrees(worktrees.data) : undefined), [worktrees.data]);
  const d = dashboard.data;
  const deletable = d?.verdicts.delete ?? 0;

  return (
    <>
      <PageHeader
        title={m.attention.title}
        subtitle={d ? m.attention.inventory(d.repositories, d.clones, d.branches) : <Skeleton className="h-4 w-56" />}
      />
      {dashboard.error ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            <Tile label={m.attention.deletable} value={d?.verdicts.delete} to="/branches" search={{ verdict: ["delete"] }} dot="bg-v-delete" />
            <Tile label={m.attention.localOnly} value={d?.verdicts["local-only"]} to="/branches" search={{ verdict: ["local-only"] }} dot="bg-v-local-only" />
            <Tile label={m.attention.needsDecision} value={d ? needsDecision(d.verdicts) : undefined} to="/branches" search={{ verdict: [...DECIDE] }} dot="bg-v-unmerged" />
            <Tile label={m.attention.dirtyWorktrees} value={wt?.changes} to="/worktrees" search={{ status: "changes" }} dot="bg-v-check" />
            <Tile label={m.attention.missingWorktrees} value={wt?.missing} to="/worktrees" search={{ status: "missing" }} dot="bg-destructive" />
            <Tile label={m.attention.openPrs} value={d?.openPullRequests} to="/prs" dot="bg-v-pr-open" />
            <Tile label={m.attention.running} value={d ? d.runningScans.length + d.runningAgentRuns : undefined} to="/agents" search={{ status: "running" }} className="col-span-2 sm:col-span-1" />
          </div>

          <Button
            className="h-12 w-full text-base md:h-10 md:w-auto md:self-start md:text-sm"
            variant={deletable ? "default" : "outline"}
            disabled={!deletable}
            onClick={() => flow.start({ kind: "delete-branch", filter: {} })}
          >
            <Trash2Icon />
            {deletable ? m.attention.cleanUp(deletable) : m.attention.nothingToClean}
          </Button>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={m.verdict["local-only"]} id="local-only"
              actions={<Button variant="ghost" size="sm" className="h-11 md:h-7" asChild><Link to="/branches" search={{ verdict: ["local-only"] }}>{m.nav.branches}<ChevronRightIcon /></Link></Button>}>
              {localOnly.isPending ? (
                <ListSkeleton rows={3} />
              ) : localOnly.error ? (
                <ErrorState error={localOnly.error} onRetry={() => void localOnly.refetch()} />
              ) : !localOnly.data.items.length ? (
                <EmptyState>{m.branches.noMatch}</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y rounded-xl border bg-card">
                  {localOnly.data.items.map((b) => {
                    const c = b.clones[0];
                    return (
                      <li key={b.id}>
                        <Link to="/branches/$id" params={{ id: b.id }} className="flex min-h-14 items-center gap-3 p-3 hover:bg-muted/50">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate font-medium">{b.name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                              {repoName(b.repo)} · <RelativeTime iso={b.date} />
                            </span>
                          </span>
                          <DivergenceBar behind={c.behind} ahead={c.ahead} base={c.base} max={Math.max(c.ahead, c.behind, 10)} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>

            <Section title={m.attention.recentScans} id="scans"
              actions={<Button variant="ghost" size="sm" className="h-11 md:h-7" asChild><Link to="/scans">{m.nav.scans}<ChevronRightIcon /></Link></Button>}>
              <Card>
                <ScanControl />
              </Card>
              {scans.isPending ? (
                <ListSkeleton rows={2} />
              ) : scans.error ? (
                <ErrorState error={scans.error} onRetry={() => void scans.refetch()} />
              ) : !scans.data.length ? (
                <EmptyState>{m.attention.noScans}</EmptyState>
              ) : (
                <div className="flex flex-col gap-2">
                  {scans.data.slice(0, 3).map((s) => (
                    <ScanRow key={s.id} scan={s} />
                  ))}
                </div>
              )}
            </Section>
          </div>
          {d && Object.keys(d.verdicts).length > 0 && (
            <Section title={m.branches.verdict} id="verdicts">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(m.verdict) as (keyof typeof m.verdict)[])
                  .filter((v) => d.verdicts[v])
                  .map((v) => (
                    <Link key={v} to="/branches" search={{ verdict: [v] }} className="inline-flex min-h-11 items-center gap-2 rounded-full md:min-h-0">
                      <VerdictBadge verdict={v} />
                      <span className="text-sm tabular-nums text-muted-foreground">{d.verdicts[v]}</span>
                    </Link>
                  ))}
              </div>
            </Section>
          )}
        </div>
      )}
      {flow.sheet}
    </>
  );
}

function Tile({ label, value, to, search, dot, className }: { label: string; value: number | undefined; to: LinkProps["to"]; search?: Record<string, unknown>; dot?: string; className?: string }) {
  return (
    <Link
      to={to}
      search={search as never}
      className={cn("flex min-h-20 flex-col justify-between gap-1 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/50", value ? "" : "text-muted-foreground", className)}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {dot && <span className={cn("size-2 rounded-full", dot)} aria-hidden="true" />}
        {label}
      </span>
      {value === undefined ? <Skeleton className="h-7 w-10" /> : <span className="text-2xl font-semibold tabular-nums">{formatCount(value)}</span>}
    </Link>
  );
}
