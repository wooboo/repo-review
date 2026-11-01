import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BellIcon, BellOffIcon, EllipsisVerticalIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { DeletedRepositories } from "@/components/deleted-repos";
import { VerdictBar } from "@/components/domain";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, SearchInput } from "@/components/filters/controls";
import { VisibilityFilters } from "@/components/filters/visibility";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { ExternalMarker, MutedBadge } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RepositorySummary, Verdict } from "@/lib/api/types";
import { repoName, repoOwner } from "@/lib/format";
import { q, useSetMuted } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { REPO_FILTER_KEYS, repoListSearch, stripDefaults, validator, visibilityInput, type RepoListSearch } from "@/lib/search";
import { needsDecision, verdictsByRepo } from "@/lib/verdicts";
import { m } from "@/messages";

export const Route = createFileRoute("/repos/")({
  validateSearch: validator(repoListSearch),
  search: { middlewares: [stripDefaults(repoListSearch)] },
  head: () => title(m.repos.title),
  component: Repos,
});

const SORTS = ["attention", "name", "branches"] as const;

function Repos() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = useCallback(
    (patch: Partial<RepoListSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace }),
    [navigate],
  );
  const deleted = search.view === "deleted";
  const visibility = visibilityInput(search);
  const repos = useQuery({ ...q.repos({ ...visibility, host: search.host || undefined, text: search.q || undefined, pageSize: 200 }), enabled: !deleted });
  const branches = useQuery({ ...q.allBranches(search.muted ? { includeMuted: true } : {}), enabled: !deleted });
  const settings = useQuery(q.settings());
  const counts = useMemo(() => verdictsByRepo(branches.data ?? []), [branches.data]);
  const rows = useMemo(() => sortRepos(repos.data?.items ?? [], search.sort, counts), [repos.data, search.sort, counts]);
  const activeCount = repoListSearch.activeCount(search, REPO_FILTER_KEYS);
  const tabs = (
    <Tabs value={search.view} onValueChange={(v) => update({ view: v === "deleted" ? "deleted" : "live" })} className="mb-3">
      <TabsList className="h-11 w-full md:h-9 md:w-auto">
        <TabsTrigger value="live" className="px-4">{m.repos.view.live}</TabsTrigger>
        <TabsTrigger value="deleted" className="px-4">{m.repos.view.deleted}</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (deleted)
    return (
      <>
        <PageHeader title={m.repos.title} />
        {tabs}
        <DeletedRepositories />
      </>
    );

  return (
    <>
      <PageHeader title={m.repos.title} subtitle={repos.data ? m.results(repos.data.total) : undefined} />
      {tabs}
      <FilterLayout
        activeCount={activeCount}
        onReset={() => update({ host: "", owner: "all", muted: false })}
        toolbar={<>
          <SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.repos.searchPlaceholder} />
          <OptionSelect className="w-auto" label={m.repos.sortLabel} value={search.sort} onChange={(v) => update({ sort: v || "attention" })}
            options={SORTS.map((s) => ({ value: s, label: m.repos.sort[s] }))} />
        </>}
        panel={(p) => (
          <>
            <FilterField label={m.repos.host} labelFor={p + "host"}>
              <OptionSelect id={p + "host"} value={search.host} onChange={(host) => update({ host })} anyLabel={m.repos.allHosts}
                options={(settings.data?.hosts ?? []).map((h) => ({ value: h.id, label: h.id }))} />
            </FilterField>
            <VisibilityFilters owner={search.owner} muted={search.muted} onChange={update} />
          </>
        )}
      >
        {repos.isPending ? (
          <ListSkeleton />
        ) : repos.error ? (
          <ErrorState error={repos.error} onRetry={() => void repos.refetch()} />
        ) : !rows.length ? (
          <EmptyState>{search.q || activeCount ? m.repos.noMatch : m.repos.empty}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {rows.map((r) => (
              <RepoRow key={r.id} repo={r} counts={counts.get(r.key)} />
            ))}
          </ul>
        )}
      </FilterLayout>
    </>
  );
}

function sortRepos(rows: RepositorySummary[], sort: RepoListSearch["sort"], counts: Map<string, Partial<Record<Verdict, number>>>) {
  const byName = (a: RepositorySummary, b: RepositorySummary) => repoName(a.key).localeCompare(repoName(b.key));
  const score = (r: RepositorySummary) => {
    const c = counts.get(r.key) ?? {};
    return (c["local-only"] ?? 0) * 1000 + needsDecision(c) * 10 + (c.delete ?? 0);
  };
  return [...rows].sort((a, b) => (sort === "name" ? byName(a, b) : sort === "branches" ? b.branches - a.branches || byName(a, b) : score(b) - score(a) || byName(a, b)));
}

function RepoRow({ repo, counts }: { repo: RepositorySummary; counts: Partial<Record<Verdict, number>> | undefined }) {
  const summary = repo.about?.summary;
  const decide = counts ? needsDecision(counts) : 0;
  return (
    <li className="relative">
      <Link to="/repos/$repo" params={{ repo: repo.key }} className="flex flex-col gap-2 p-3 pr-14 hover:bg-muted/50 md:pr-12">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-medium break-all">{repoName(repo.key)}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {m.repos.branches(repo.branches)} · {m.repos.clones(repo.clones)}
          </span>
        </span>
        <span className="-mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{repoOwner(repo.key)}</span>
          {!repo.mine && repo.owner && <ExternalMarker owner={repo.owner} />}
          {repo.muted && <MutedBadge className="h-5" />}
        </span>
        <VerdictBar counts={counts ?? {}} />
        {(summary || decide > 0 || counts?.["local-only"]) && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {counts?.["local-only"] ? <span className="font-medium text-v-local-only">{m.verdict["local-only"]}: {counts["local-only"]}</span> : null}
            {decide > 0 && <span>{m.attention.needsDecision}: {decide}</span>}
            {counts?.delete ? <span>{m.verdict.delete}: {counts.delete}</span> : null}
            {summary && <span className="line-clamp-1 basis-full">{summary}</span>}
          </span>
        )}
      </Link>
      <RepoMenu repo={repo} />
    </li>
  );
}

function RepoMenu({ repo }: { repo: RepositorySummary }) {
  const mute = useSetMuted();
  const name = repoName(repo.key);
  const set = (muted: boolean) => mute.mutate({ repositoryId: repo.key, muted });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={m.repos.menu(name)} className="absolute top-1.5 right-1.5 md:top-2 md:right-2">
          <EllipsisVerticalIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={() => set(!repo.muted)}>
          {repo.muted ? <BellIcon /> : <BellOffIcon />}
          {repo.muted ? m.mute.unmuteRepo : m.mute.muteRepo}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
