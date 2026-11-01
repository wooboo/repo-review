import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { FilterLayout, OptionSelect, SearchInput } from "@/components/filters/controls";
import { PageHeader, Section } from "@/components/page-header";
import { WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import type { WorktreeItem } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { stripDefaults, validator, WORKTREE_FILTER_KEYS, worktreeSearch, type WorktreeSearch } from "@/lib/search";
import { m } from "@/messages";

export const Route = createFileRoute("/worktrees")({
  validateSearch: validator(worktreeSearch),
  search: { middlewares: [stripDefaults(worktreeSearch)] },
  head: () => title(m.worktrees.title),
  component: Worktrees,
});

/** Newest change first; entries without files keep their order. */
const newest = (w: WorktreeItem) => w.files.reduce((t, f) => (f.mtime && f.mtime > t ? f.mtime : t), "");

function Worktrees() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = useCallback((patch: Partial<WorktreeSearch>, replace = false) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace }), [navigate]);
  const rows = useQuery(q.worktrees({ host: search.host || undefined, repo: search.repo || undefined, text: search.q || undefined, dirty: search.dirty || undefined }));
  const settings = useQuery(q.settings());
  const repos = useQuery(q.repos({ pageSize: 200 }));
  const groups = useMemo(() => {
    const all = rows.data ?? [];
    return {
      missing: all.filter((w) => !w.exists),
      dirty: all.filter((w) => w.exists && w.dirty).sort((a, b) => newest(b).localeCompare(newest(a))),
      clean: all.filter((w) => w.exists && !w.dirty),
    };
  }, [rows.data]);
  const activeCount = worktreeSearch.activeCount(search, WORKTREE_FILTER_KEYS);

  return (
    <>
      <PageHeader title={m.worktrees.title} subtitle={rows.data ? m.results(rows.data.length) : undefined} />
      <FilterLayout
        activeCount={activeCount}
        onReset={() => update({ host: "", repo: "", dirty: false })}
        toolbar={<SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.worktrees.searchPlaceholder} />}
        panel={(p) => (
          <>
            <FilterField label={m.branches.repo} labelFor={p + "repo"}>
              <OptionSelect id={p + "repo"} value={search.repo} onChange={(repo) => update({ repo })} anyLabel={m.branches.allRepos}
                options={(repos.data?.items ?? []).map((r) => ({ value: r.key, label: repoName(r.key) })).sort((a, b) => a.label.localeCompare(b.label))} />
            </FilterField>
            <FilterField label={m.branches.host} labelFor={p + "host"}>
              <OptionSelect id={p + "host"} value={search.host} onChange={(host) => update({ host })} anyLabel={m.branches.allHosts}
                options={(settings.data?.hosts ?? []).map((h) => ({ value: h.id, label: h.id }))} />
            </FilterField>
            <SwitchRow label={m.worktrees.onlyDirty}><Switch checked={search.dirty} onCheckedChange={(dirty) => update({ dirty })} /></SwitchRow>
          </>
        )}
      >
        {rows.isPending ? (
          <ListSkeleton />
        ) : rows.error ? (
          <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
        ) : !rows.data.length ? (
          <EmptyState>{activeCount || search.q ? m.worktrees.noMatch : m.worktrees.empty}</EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.dirty.length > 0 && (
              <Section title={`${m.worktrees.dirty} · ${groups.dirty.length}`} id="dirty">
                <div className="flex flex-col gap-2">{groups.dirty.map((w) => <WorktreeCard key={w.id} worktree={w} />)}</div>
              </Section>
            )}
            {groups.missing.length > 0 && (
              <Section title={`${m.worktrees.missing} · ${groups.missing.length}`} id="missing">
                <div className="flex flex-col gap-2">{groups.missing.map((w) => <WorktreeCard key={w.id} worktree={w} />)}</div>
              </Section>
            )}
            {groups.clean.length > 0 && (
              <Collapsible defaultOpen={!groups.dirty.length && !groups.missing.length} className="flex flex-col gap-2">
                <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 text-left text-sm font-semibold tracking-tight text-muted-foreground uppercase md:min-h-8">
                  {m.worktrees.clean(groups.clean.length)}
                  <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-2">
                  {groups.clean.map((w) => <WorktreeCard key={w.id} worktree={w} />)}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </FilterLayout>
    </>
  );
}
