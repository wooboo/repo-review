import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, EraserIcon, UndoIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useActionFlow } from "@/components/action-flow";
import { FilterField } from "@/components/filters/field";
import { FilterLayout, OptionSelect, SearchInput } from "@/components/filters/controls";
import { PageHeader, Section } from "@/components/page-header";
import { WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { branchId } from "@/lib/api/ids";
import type { PlanInput, Verdict, WorktreeItem } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { stripDefaults, validator, WORKTREE_FILTER_KEYS, worktreeSearch, type WorktreeSearch } from "@/lib/search";
import { canPrune, canSwitchToBase, clonePathOf, WORKTREE_STATUSES, worktreeStatus } from "@/lib/worktrees";
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
  // The server's `dirty` filter also matches missing directories, so status is filtered here.
  const rows = useQuery(q.worktrees({ host: search.host || undefined, repo: search.repo || undefined, text: search.q || undefined }));
  const settings = useQuery(q.settings());
  const repos = useQuery(q.repos({ pageSize: 200 }));
  const branches = useQuery(q.allBranches());
  const verdicts = useMemo(() => new Map((branches.data ?? []).map((b) => [b.id, b.verdict])), [branches.data]);
  const flow = useActionFlow();
  const client = useQueryClient();
  const w2v = (w: WorktreeItem): Verdict | undefined => (w.branch ? verdicts.get(branchId(w.repo, w.branch)) : undefined);
  const groups = useMemo(() => {
    const all = (rows.data ?? []).filter((w) => !search.status || worktreeStatus(w) === search.status);
    return {
      changes: all.filter((w) => worktreeStatus(w) === "changes").sort((a, b) => newest(b).localeCompare(newest(a))),
      missing: all.filter((w) => worktreeStatus(w) === "missing"),
      // Checkouts that can switch back to their base come first.
      clean: all
        .filter((w) => worktreeStatus(w) === "clean")
        .sort((a, b) => Number(canSwitchToBase(b, w2v(b))) - Number(canSwitchToBase(a, w2v(a)))),
      total: all.length,
    };
  }, [rows.data, search.status, verdicts]);
  const activeCount = worktreeSearch.activeCount(search, WORKTREE_FILTER_KEYS);

  /** Target clone path comes from the repository detail (one key can have several clones per host). */
  const plan = async (w: WorktreeItem, kind: "prune-worktree" | "switch-to-base") => {
    const repo = await client.fetchQuery(q.repo(w.repo));
    const clone = clonePathOf(repo.clones, w.host, w.path) ?? w.path;
    const request: PlanInput =
      kind === "prune-worktree"
        ? { kind, targets: [{ host: w.host, repo: clone, worktree: w.path }] }
        : { kind, targets: [{ host: w.host, repo: clone, branch: w.branch ?? undefined, worktree: w.path }] };
    flow.start(request);
  };
  const actionsFor = (w: WorktreeItem) => {
    const verdict = w2v(w);
    if (canPrune(w))
      return (
        <Button variant="outline" className="h-11 md:h-8" onClick={() => void plan(w, "prune-worktree")}>
          <EraserIcon />{m.worktrees.prune}
        </Button>
      );
    if (canSwitchToBase(w, verdict))
      return (
        <Button variant="outline" className="h-11 md:h-8" onClick={() => void plan(w, "switch-to-base")}>
          <UndoIcon />{m.worktrees.switchToBase}
        </Button>
      );
    return undefined;
  };
  const cleanHasActions = groups.clean.some((w) => actionsFor(w) !== undefined);
  const card = (w: WorktreeItem) => <WorktreeCard key={w.id} worktree={w} actions={actionsFor(w)} />;

  return (
    <>
      <PageHeader title={m.worktrees.title} subtitle={rows.data ? m.results(groups.total) : undefined} />
      <FilterLayout
        activeCount={activeCount}
        onReset={() => update({ host: "", repo: "", status: "" })}
        toolbar={<SearchInput value={search.q} onChange={(v) => update({ q: v }, true)} placeholder={m.worktrees.searchPlaceholder} />}
        panel={(p) => (
          <>
            <FilterField label={m.worktrees.statusLabel}>
              <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={search.status || "all"}
                onValueChange={(v) => { if (v) update({ status: v === "all" ? "" : WORKTREE_STATUSES.find((s) => s === v) ?? "" }); }}>
                <ToggleGroupItem value="all" className="h-11 flex-1 px-2 md:h-8">{m.all}</ToggleGroupItem>
                {WORKTREE_STATUSES.map((s) => (
                  <ToggleGroupItem key={s} value={s} className="h-11 flex-1 px-2 md:h-8">{m.worktrees.status[s]}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FilterField>
            <FilterField label={m.branches.repo} labelFor={p + "repo"}>
              <OptionSelect id={p + "repo"} value={search.repo} onChange={(repo) => update({ repo })} anyLabel={m.branches.allRepos}
                options={(repos.data?.items ?? []).map((r) => ({ value: r.key, label: repoName(r.key) })).sort((a, b) => a.label.localeCompare(b.label))} />
            </FilterField>
            <FilterField label={m.branches.host} labelFor={p + "host"}>
              <OptionSelect id={p + "host"} value={search.host} onChange={(host) => update({ host })} anyLabel={m.branches.allHosts}
                options={(settings.data?.hosts ?? []).map((h) => ({ value: h.id, label: h.id }))} />
            </FilterField>
          </>
        )}
      >
        {rows.isPending ? (
          <ListSkeleton />
        ) : rows.error ? (
          <ErrorState error={rows.error} onRetry={() => void rows.refetch()} />
        ) : !groups.total ? (
          <EmptyState>{activeCount || search.q ? m.worktrees.noMatch : m.worktrees.empty}</EmptyState>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.changes.length > 0 && (
              <Section title={`${m.worktrees.dirty} · ${groups.changes.length}`} id="changes">
                <div className="flex flex-col gap-2">{groups.changes.map(card)}</div>
              </Section>
            )}
            {groups.missing.length > 0 && (
              <Section title={`${m.worktrees.missing} · ${groups.missing.length}`} id="missing">
                <div className="flex flex-col gap-2">{groups.missing.map(card)}</div>
              </Section>
            )}
            {groups.clean.length > 0 && (
              <Collapsible
                // Re-mounts (and opens) once branch verdicts reveal a checkout that can switch to its base.
                key={cleanHasActions ? "actions" : "plain"}
                defaultOpen={search.status === "clean" || (!groups.changes.length && !groups.missing.length) || cleanHasActions}
                className="flex flex-col gap-2"
              >
                <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 text-left text-sm font-semibold tracking-tight text-muted-foreground uppercase md:min-h-8">
                  {m.worktrees.clean(groups.clean.length)}
                  <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-2">{groups.clean.map(card)}</CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </FilterLayout>
      {flow.sheet}
    </>
  );
}
