import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, Pagination, SearchInput } from "@/components/filters/controls";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { PrRow, RowList } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { refreshPullRequests } from "@/lib/api/client";
import { repoName } from "@/lib/format";
import { q, useJob } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { PR_FILTER_KEYS, prListSearch, stripDefaults, validator, type PrListSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export const Route = createFileRoute("/prs/")({
  validateSearch: validator(prListSearch),
  search: { middlewares: [stripDefaults(prListSearch)] },
  head: () => title(m.prs.title),
  component: Prs,
});

const PAGE_SIZE = 30;
const CHECKS = ["success", "failure", "pending", "none"] as const;

function Prs() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const client = useQueryClient();
  const update = useCallback(
    (patch: Partial<PrListSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }), replace }),
    [navigate],
  );
  const settings = useQuery(q.settings());
  const repos = useQuery(q.repos({ pageSize: 200 }));
  // TODO(contract-gap): the checks filter is applied to the page; the server list has no checks filter.
  const prs = useQuery({
    ...q.prs({ repo: search.repo || undefined, state: search.state, text: search.q || undefined, page: search.checks ? 1 : search.page, pageSize: search.checks ? 100_000 : PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: (settings.data?.forges.length ?? 0) > 0,
  });
  const items = useMemo(() => {
    const all = (prs.data?.items ?? []).filter((p) => !search.checks || p.checks.state === search.checks);
    return search.checks ? all.slice((search.page - 1) * PAGE_SIZE, search.page * PAGE_SIZE) : all;
  }, [prs.data, search.checks, search.page]);
  const total = search.checks ? (prs.data?.items ?? []).filter((p) => p.checks.state === search.checks).length : (prs.data?.total ?? 0);
  const refresh = useMutation({ mutationFn: () => refreshPullRequests({ repo: search.repo || undefined }) });
  const refreshJob = useJob(refresh.data?.id ?? null, () => null);
  const refreshing = refresh.isPending || refreshJob.data?.status === "running";
  const refreshStatus = refreshJob.data?.status;
  useEffect(() => {
    if (refreshStatus !== "done" && refreshStatus !== "failed") return;
    refresh.reset();
    void client.invalidateQueries({ queryKey: ["prs"] });
  }, [refreshStatus, client]);
  const activeCount = prListSearch.activeCount(search, PR_FILTER_KEYS);
  const noForges = settings.data && !settings.data.forges.length;

  return (
    <>
      <PageHeader
        title={m.prs.title}
        subtitle={prs.data ? m.results(total) : undefined}
        actions={!noForges && (
          <IconButton label={m.prs.refresh} disabled={refreshing} onClick={() => refresh.mutate()}>
            <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
          </IconButton>
        )}
      />
      {noForges ? (
        <EmptyState action={<Button asChild variant="outline" className="h-11 md:h-9"><Link to="/settings">{m.nav.settings}</Link></Button>}>{m.prs.noForges}</EmptyState>
      ) : (
        <FilterLayout
          activeCount={activeCount}
          onReset={() => update({ state: "open", repo: "", checks: "" })}
          toolbar={<SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.prs.searchPlaceholder} />}
          panel={(p) => (
            <>
              <FilterField label={m.branches.state}>
                <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={search.state}
                  onValueChange={(v) => { if (v === "open" || v === "merged" || v === "closed" || v === "all") update({ state: v }); }}>
                  {(["open", "merged", "closed", "all"] as const).map((s) => (
                    <ToggleGroupItem key={s} value={s} className="h-11 flex-1 px-2 md:h-8">{m.prs.state[s]}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FilterField>
              <FilterField label={m.branches.repo} labelFor={p + "repo"}>
                <OptionSelect id={p + "repo"} value={search.repo} onChange={(repo) => update({ repo })} anyLabel={m.branches.allRepos}
                  options={(repos.data?.items ?? []).filter((r) => settings.data?.forges.some((f) => r.key.startsWith(f.host + "/"))).map((r) => ({ value: r.key, label: repoName(r.key) })).sort((a, b) => a.label.localeCompare(b.label))} />
              </FilterField>
              <FilterField label={m.prs.checksFilter} labelFor={p + "checks"}>
                <OptionSelect id={p + "checks"} value={search.checks} onChange={(checks) => update({ checks })} anyLabel={m.any}
                  options={CHECKS.map((c) => ({ value: c, label: m.prs.checks[c] }))} />
              </FilterField>
            </>
          )}
        >
          {prs.isPending ? (
            <ListSkeleton />
          ) : prs.error ? (
            <ErrorState error={prs.error} onRetry={() => void prs.refetch()} />
          ) : !items.length ? (
            <EmptyState>{m.prs.empty}</EmptyState>
          ) : (
            <>
              <RowList className={cn(prs.isPlaceholderData && "opacity-60")}>{items.map((p) => <PrRow key={p.id} pr={p} />)}</RowList>
              <Pagination page={search.page} total={total} pageSize={PAGE_SIZE} onPage={(page) => update({ page })} />
            </>
          )}
        </FilterLayout>
      )}
    </>
  );
}
