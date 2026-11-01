import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, Pagination, SearchInput } from "@/components/filters/controls";
import { VisibilityFilters } from "@/components/filters/visibility";
import { PageHeader } from "@/components/page-header";
import { PrRow, RowList } from "@/components/rows";
import { SyncPrsButton } from "@/components/sync-prs";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { PR_FILTER_KEYS, prListSearch, stripDefaults, validator, visibilityInput, type PrListSearch } from "@/lib/search";
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
  const update = useCallback(
    (patch: Partial<PrListSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }), replace }),
    [navigate],
  );
  const settings = useQuery(q.settings());
  const repos = useQuery(q.repos({ pageSize: 200, ...(search.muted ? { includeMuted: true } : {}) }));
  const hasForges = (settings.data?.forges.length ?? 0) > 0;
  // "Mine" on pull requests means the PR author is one of your accounts (not the repository owner).
  const filter = { repo: search.repo || undefined, state: search.state, text: search.q || undefined, checks: search.checks || undefined, ...visibilityInput(search) };
  const prs = useQuery({ ...q.prs({ ...filter, page: search.page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData, enabled: hasForges });
  const page = prs.data;
  const items = page?.items ?? [];
  const total = page?.total ?? 0;
  const activeCount = prListSearch.activeCount(search, PR_FILTER_KEYS);
  const noForges = settings.data && !settings.data.forges.length;

  return (
    <>
      <PageHeader
        title={m.prs.title}
        subtitle={page ? m.results(total) : undefined}
        actions={!noForges && <SyncPrsButton repo={search.repo || undefined} />}
      />
      {noForges ? (
        <EmptyState action={<Button asChild variant="outline" className="h-11 md:h-9"><Link to="/settings">{m.nav.settings}</Link></Button>}>{m.prs.noForges}</EmptyState>
      ) : (
        <FilterLayout
          activeCount={activeCount}
          onReset={() => update({ state: "open", repo: "", checks: "", owner: "all", muted: false })}
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
              <VisibilityFilters label={m.visibility.author} owner={search.owner} muted={search.muted} onChange={update} />
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
