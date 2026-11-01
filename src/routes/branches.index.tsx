import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { Dot, verdictBg } from "@/components/domain";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { FilterLayout, OptionSelect, Pagination, SearchInput } from "@/components/filters/controls";
import { PageHeader } from "@/components/page-header";
import { HistoryRow } from "@/components/provenance";
import { BranchRow, divergenceMax, RowList, usePrsByBranch } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { State } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { BRANCH_FILTER_KEYS, branchSearch, stripDefaults, validator, type BranchSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { VERDICTS } from "@/lib/verdicts";
import { m } from "@/messages";

export const Route = createFileRoute("/branches/")({
  validateSearch: validator(branchSearch),
  search: { middlewares: [stripDefaults(branchSearch)] },
  head: () => title(m.branches.title),
  component: Branches,
});

const PAGE_SIZE = 50;
const STATES: State[] = ["unmerged", "pr-merged-changed", "pr-merged", "merged", "patch-merged", "squash-merged", "content-in-base", "no-base", "base"];
const JEV = ["delete", "archive", "keep", "finish_and_merge"] as const;

function Branches() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = useCallback(
    (patch: Partial<BranchSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }), replace }),
    [navigate],
  );
  const dashboard = useQuery(q.dashboard());
  const jevEnabled = dashboard.data?.jevEnabled ?? false;
  const gone = search.view === "gone";
  const input = {
    text: search.q || undefined,
    verdicts: search.verdict,
    jev: search.jev || undefined,
    host: search.host || undefined,
    repo: search.repo || undefined,
    state: search.state || undefined,
    stale: search.stale || undefined,
    dirty: search.dirty || undefined,
    localOnly: search.localOnly || undefined,
    sort: search.sort,
    page: search.page,
    pageSize: PAGE_SIZE,
  };
  const branches = useQuery({ ...q.branches(input), placeholderData: keepPreviousData, enabled: !gone });
  const history = useQuery({ ...q.history({ text: search.q || undefined, repo: search.repo || undefined, gone: true, page: search.page, pageSize: PAGE_SIZE }), placeholderData: keepPreviousData, enabled: gone });
  const prs = usePrsByBranch();
  const items = branches.data?.items ?? [];
  const goneItems = history.data?.items ?? [];
  const max = useMemo(() => divergenceMax(items), [items]);
  const filterKeys = gone ? (["repo"] as const) : BRANCH_FILTER_KEYS;
  const activeCount = branchSearch.activeCount(search, filterKeys);
  const reset = () => update(Object.fromEntries(filterKeys.map((k) => [k, branchSearch.defaults[k]])) as Partial<BranchSearch>);
  const total = gone ? history.data?.total : branches.data?.total;

  return (
    <>
      <PageHeader title={m.branches.title} subtitle={total !== undefined ? m.results(total) : undefined} />
      <Tabs value={search.view} onValueChange={(v) => update({ view: v === "gone" ? "gone" : "live" })} className="mb-3">
        <TabsList className="h-11 w-full md:h-9 md:w-auto">
          <TabsTrigger value="live" className="px-4">{m.branches.view.live}</TabsTrigger>
          <TabsTrigger value="gone" className="px-4">{m.branches.view.gone}</TabsTrigger>
        </TabsList>
      </Tabs>
      <FilterLayout
        activeCount={activeCount}
        onReset={reset}
        toolbar={<>
          <SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.branches.searchPlaceholder} />
          {!gone && (
            <OptionSelect className="w-auto" label={m.branches.sortLabel} value={search.sort} onChange={(v) => update({ sort: v || "date" })}
              options={(["date", "name"] as const).map((s) => ({ value: s, label: m.branches.sort[s] }))} />
          )}
        </>}
        panel={(p) => <Filters idPrefix={p} search={search} update={update} jevEnabled={jevEnabled} gone={gone} />}
      >
        {gone ? (
          history.error ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : !history.data ? (
            <ListSkeleton />
          ) : !goneItems.length ? (
            <EmptyState>{search.q || search.repo ? m.branches.goneNoMatch : m.branches.goneEmpty}</EmptyState>
          ) : (
            <>
              <RowList className={cn(history.isPlaceholderData && "opacity-60 transition-opacity")}>
                {goneItems.map((h) => <HistoryRow key={`${h.host}:${h.clonePath}#${h.branch}@${h.sha}`} item={h} />)}
              </RowList>
              <Pagination page={search.page} total={history.data.total} pageSize={PAGE_SIZE} onPage={(page) => update({ page })} />
            </>
          )
        ) : <>
        {search.verdict.length > 0 && (
          <div className="flex flex-wrap gap-1 lg:hidden">
            {search.verdict.map((v) => (
              <button key={v} type="button" onClick={() => update({ verdict: search.verdict.filter((x) => x !== v) })}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium" aria-label={`${m.verdict[v]} ×`}>
                <Dot className={verdictBg[v]} />{m.verdict[v]} <span aria-hidden="true" className="text-muted-foreground">×</span>
              </button>
            ))}
          </div>
        )}
        {branches.isPending ? (
          <ListSkeleton />
        ) : branches.error ? (
          <ErrorState error={branches.error} onRetry={() => void branches.refetch()} />
        ) : !items.length ? (
          <EmptyState>{activeCount || search.q ? m.branches.noMatch : m.branches.empty}</EmptyState>
        ) : (
          <>
            <RowList className={cn(branches.isPlaceholderData && "opacity-60 transition-opacity")}>
              {items.map((b) => <BranchRow key={b.id} branch={b} max={max} pr={prs.get(b.id)} />)}
            </RowList>
            <Pagination page={search.page} total={branches.data.total} pageSize={PAGE_SIZE} onPage={(page) => update({ page })} />
          </>
        )}
        </>}
      </FilterLayout>
    </>
  );
}

function Filters({ idPrefix: p, search, update, jevEnabled, gone }: { idPrefix: string; search: BranchSearch; update: (patch: Partial<BranchSearch>) => void; jevEnabled: boolean; gone: boolean }) {
  const settings = useQuery(q.settings());
  const repos = useQuery(q.repos({ pageSize: 200 }));
  const repo = (
    <FilterField label={m.branches.repo} labelFor={p + "repo"}>
      <OptionSelect id={p + "repo"} value={search.repo} onChange={(repo) => update({ repo })} anyLabel={m.branches.allRepos}
        options={(repos.data?.items ?? []).map((r) => ({ value: r.key, label: repoName(r.key) })).sort((a, b) => a.label.localeCompare(b.label))} />
    </FilterField>
  );
  if (gone) return repo;
  return (
    <>
      <FilterField label={m.branches.verdict}>
        <ToggleGroup type="multiple" variant="outline" className="flex-wrap justify-start" value={[...search.verdict]}
          onValueChange={(v) => update({ verdict: VERDICTS.filter((x) => v.includes(x)) })}>
          {VERDICTS.map((v) => (
            <ToggleGroupItem key={v} value={v} className="h-11 gap-1.5 px-2.5 md:h-8">
              <Dot className={cn(verdictBg[v], "ring-1 ring-background")} />
              {m.verdict[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FilterField>
      {repo}
      <FilterField label={m.branches.host} labelFor={p + "host"}>
        <OptionSelect id={p + "host"} value={search.host} onChange={(host) => update({ host })} anyLabel={m.branches.allHosts}
          options={(settings.data?.hosts ?? []).map((h) => ({ value: h.id, label: h.id }))} />
      </FilterField>
      <FilterField label={m.branches.state} labelFor={p + "state"}>
        <OptionSelect id={p + "state"} value={search.state} onChange={(state) => update({ state })} anyLabel={m.branches.allStates}
          options={STATES.map((s) => ({ value: s, label: m.state[s] }))} />
      </FilterField>
      {jevEnabled && (
        <FilterField label={m.branches.jev} labelFor={p + "jev"}>
          <OptionSelect id={p + "jev"} value={search.jev} onChange={(jev) => update({ jev })} anyLabel={m.any}
            options={JEV.map((j) => ({ value: j, label: m.jev[j] }))} />
        </FilterField>
      )}
      <div className="flex flex-col">
        <SwitchRow label={m.branches.stale}><Switch checked={search.stale} onCheckedChange={(stale) => update({ stale })} /></SwitchRow>
        <SwitchRow label={m.branches.dirty}><Switch checked={search.dirty} onCheckedChange={(dirty) => update({ dirty })} /></SwitchRow>
        <SwitchRow label={m.branches.localOnly}><Switch checked={search.localOnly} onCheckedChange={(localOnly) => update({ localOnly })} /></SwitchRow>
      </div>
    </>
  );
}
