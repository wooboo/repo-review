import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { VerdictBar } from "@/components/domain";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, SearchInput } from "@/components/filters/controls";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import type { RepositorySummary, Verdict } from "@/lib/api/types";
import { repoName, repoOwner } from "@/lib/format";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { repoListSearch, stripDefaults, validator, type RepoListSearch } from "@/lib/search";
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
  const repos = useQuery(q.repos({ host: search.host || undefined, text: search.q || undefined, pageSize: 200 }));
  const branches = useQuery(q.allBranches());
  const settings = useQuery(q.settings());
  const counts = useMemo(() => verdictsByRepo(branches.data ?? []), [branches.data]);
  const rows = useMemo(() => sortRepos(repos.data?.items ?? [], search.sort, counts), [repos.data, search.sort, counts]);
  const activeCount = repoListSearch.activeCount(search, ["host"]);

  return (
    <>
      <PageHeader title={m.repos.title} subtitle={repos.data ? m.results(repos.data.total) : undefined} />
      <FilterLayout
        activeCount={activeCount}
        onReset={() => update({ host: "" })}
        toolbar={<>
          <SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.repos.searchPlaceholder} />
          <OptionSelect className="w-auto" label={m.repos.sortLabel} value={search.sort} onChange={(v) => update({ sort: v || "attention" })}
            options={SORTS.map((s) => ({ value: s, label: m.repos.sort[s] }))} />
        </>}
        panel={(p) => (
          <FilterField label={m.repos.host} labelFor={p + "host"}>
            <OptionSelect id={p + "host"} value={search.host} onChange={(host) => update({ host })} anyLabel={m.repos.allHosts}
              options={(settings.data?.hosts ?? []).map((h) => ({ value: h.id, label: h.id }))} />
          </FilterField>
        )}
      >
        {repos.isPending ? (
          <ListSkeleton />
        ) : repos.error ? (
          <ErrorState error={repos.error} onRetry={() => void repos.refetch()} />
        ) : !rows.length ? (
          <EmptyState>{search.q || search.host ? m.repos.noMatch : m.repos.empty}</EmptyState>
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
    <li>
      <Link to="/repos/$repo" params={{ repo: repo.key }} className="flex flex-col gap-2 p-3 hover:bg-muted/50">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-medium break-all">{repoName(repo.key)}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {m.repos.branches(repo.branches)} · {m.repos.clones(repo.clones)}
          </span>
        </span>
        <span className="-mt-1.5 truncate text-xs text-muted-foreground">{repoOwner(repo.key)}</span>
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
    </li>
  );
}
