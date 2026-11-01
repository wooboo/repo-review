import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { RelativeTime, StatusBadge } from "@/components/domain";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, Pagination } from "@/components/filters/controls";
import { PageHeader } from "@/components/page-header";
import { RowList } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AgentRun } from "@/lib/api/types";
import { formatCost, formatDuration, repoName } from "@/lib/format";
import { POLL_MS, q, useLiveMode } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { agentListSearch, stripDefaults, validator, type AgentListSearch } from "@/lib/search";
import { m } from "@/messages";

export const Route = createFileRoute("/agents/")({
  validateSearch: validator(agentListSearch),
  search: { middlewares: [stripDefaults(agentListSearch)] },
  head: () => title(m.agents.title),
  component: Agents,
});

const PAGE_SIZE = 30;
const STATUSES = ["queued", "running", "done", "failed", "cancelled"] as const;

function Agents() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = useCallback((patch: Partial<AgentListSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }) }), [navigate]);
  const input = { status: search.status || undefined, repo: search.repo || undefined, page: search.page, pageSize: PAGE_SIZE };
  const live = useLiveMode();
  const runs = useQuery({
    ...q.runs(input),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (live !== "sse" && query.state.data?.items.some((r) => r.status === "running" || r.status === "queued") ? POLL_MS : false),
  });
  const agents = useQuery(q.agents());
  const repos = useQuery(q.repos({ pageSize: 200 }));
  const activeCount = agentListSearch.activeCount(search, ["status", "repo"]);

  return (
    <>
      <PageHeader title={m.agents.title} subtitle={runs.data ? m.results(runs.data.total) : undefined} />
      {agents.data && !agents.data.length && (
        <EmptyState className="mb-4" action={<Button asChild variant="outline" className="h-11 md:h-9"><Link to="/settings">{m.nav.settings}</Link></Button>}>{m.agents.noAgents}</EmptyState>
      )}
      <FilterLayout
        activeCount={activeCount}
        onReset={() => update({ status: "", repo: "" })}
        toolbar={
          <ToggleGroup type="single" variant="outline" spacing={0} className="min-w-0 flex-1 lg:hidden" value={search.status || "all"}
            onValueChange={(v) => update({ status: v === "running" || v === "failed" ? v : "" })}>
            <ToggleGroupItem value="all" className="h-11 flex-1 px-2">{m.all}</ToggleGroupItem>
            <ToggleGroupItem value="running" className="h-11 flex-1 px-2">{m.agents.status.running}</ToggleGroupItem>
            <ToggleGroupItem value="failed" className="h-11 flex-1 px-2">{m.agents.status.failed}</ToggleGroupItem>
          </ToggleGroup>
        }
        panel={(p) => (
          <>
            <FilterField label={m.agents.statusFilter} labelFor={p + "status"}>
              <OptionSelect id={p + "status"} value={search.status} onChange={(status) => update({ status })} anyLabel={m.any}
                options={STATUSES.map((s) => ({ value: s, label: m.agents.status[s] }))} />
            </FilterField>
            <FilterField label={m.branches.repo} labelFor={p + "repo"}>
              <OptionSelect id={p + "repo"} value={search.repo} onChange={(repo) => update({ repo })} anyLabel={m.branches.allRepos}
                options={(repos.data?.items ?? []).map((r) => ({ value: r.key, label: repoName(r.key) })).sort((a, b) => a.label.localeCompare(b.label))} />
            </FilterField>
          </>
        )}
      >
        {runs.isPending ? (
          <ListSkeleton />
        ) : runs.error ? (
          <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
        ) : !runs.data.items.length ? (
          <EmptyState>{m.agents.empty}</EmptyState>
        ) : (
          <>
            <RowList>{runs.data.items.map((r) => <RunRow key={r.id} run={r} />)}</RowList>
            <Pagination page={search.page} total={runs.data.total} pageSize={PAGE_SIZE} onPage={(page) => update({ page })} />
          </>
        )}
      </FilterLayout>
    </>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const target = run.branchId?.split("#").slice(1).join("#");
  const duration = run.finishedAt ? formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : "";
  return (
    <li>
      <Link to="/agents/$run" params={{ run: run.id }} className="flex flex-col gap-1.5 p-3 hover:bg-muted/50">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium break-all">
            {m.agents.tasks[run.task]} · {repoName(run.repo)}{target ? ` · ${target}` : ""}
          </span>
          <StatusBadge status={run.status} label={m.agents.status[run.status]} />
        </span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{run.agentId} · {run.model}</span>
          <RelativeTime iso={run.startedAt} />
          {duration && <span>{duration}</span>}
          {run.costUsd !== null && <span>{formatCost(run.costUsd)}</span>}
        </span>
        {run.summary && <span className="line-clamp-2 text-sm text-muted-foreground">{run.summary}</span>}
      </Link>
    </li>
  );
}
