import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BellIcon, BellOffIcon, ChevronDownIcon, EraserIcon, ExternalLinkIcon, FastForwardIcon, PencilIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useActionFlow } from "@/components/action-flow";
import { useRepositoryDeletion, type DeletionClone } from "@/components/delete-repository";
import { IconButton } from "@/components/icon-button";
import { FilterField } from "@/components/filters/field";
import { OptionSelect, Pagination } from "@/components/filters/controls";
import { LandingRow } from "@/components/provenance";
import { ScrollTabsList } from "@/components/scroll-tabs";
import { SyncPrsButton } from "@/components/sync-prs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dot, KV, Mono, Pill, RelativeTime, verdictBg } from "@/components/domain";
import { NewRunButton } from "@/components/new-run";
import { Card, PageHeader, Section } from "@/components/page-header";
import { BranchRow, divergenceMax, ExternalMarker, MutedBadge, PrRow, RowList, usePrsByBranch, WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton, PageSkeleton } from "@/components/states";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import type { ActionTarget, Clone, PlanInput, RepositoryDetail, WorktreeItem } from "@/lib/api/types";
import { parseStash, readmeSummary, repoName, repoOwner, shortSha, stripRemote } from "@/lib/format";
import { q, useSetMuted } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { repoSearch, stripDefaults, validator, type RepoSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import { divergingShas, groupByVerdict } from "@/lib/verdicts";
import { canFastForward, canPrune, canSwitchToBase, hasChanges, isMissing } from "@/lib/worktrees";
import { m } from "@/messages";

export const Route = createFileRoute("/repos/$repo")({
  validateSearch: validator(repoSearch),
  search: { middlewares: [stripDefaults(repoSearch)] },
  head: (ctx: { params: { repo: string } }) => title(repoName(ctx.params.repo), m.repos.title),
  loader: (ctx) => prefetch(ctx.context.queryClient, q.repo(ctx.params.repo)),
  component: RepoPage,
});

const TABS = ["overview", "branches", "worktrees", "prs", "landings"] as const;
const LANDINGS_PAGE = 30;

function RepoPage(): React.ReactNode {
  const { repo: key } = Route.useParams();
  const search = Route.useSearch();
  const flow = useActionFlow();
  const deletion = useRepositoryDeletion();
  const repo = useQuery(q.repo(key));
  const settings = useQuery(q.settings());
  const hasForge = settings.data?.forges.some((f) => key.startsWith(f.host + "/")) ?? false;
  const r0 = repo.data;
  const header = (
    <PageHeader
      back="/repos"
      title={repoName(key)}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{repoOwner(key)}</span>
          {r0 && !r0.mine && r0.owner && <ExternalMarker owner={r0.owner} />}
          {r0?.muted && <MutedBadge className="h-5" />}
        </span>
      }
      actions={<>
        {r0 && r0.clones.length > 0 && <MuteButton repositoryId={key} muted={r0.muted} />}
        <NewRunButton target={{ repo: key, label: key }} />
      </>}
    />
  );
  // One return with the sheets at fixed positions: a purge empties this page behind the open
  // deletion sheet, which must keep its state (results, restore recipes) until it is closed.
  return (
    <>
      {header}
      {repo.isPending ? (
        <PageSkeleton />
      ) : repo.error ? (
        <ErrorState error={repo.error} onRetry={() => void repo.refetch()} />
      ) : !repo.data.clones.length ? (
        <EmptyState>{m.notFound}</EmptyState>
      ) : (
        <RepoTabs repo={repo.data} search={search} hasForge={hasForge} onPlan={flow.start}
          onDelete={(cloneId) => deletion.start(key, repoName(key), repo.data.clones.map((c): DeletionClone => ({ id: c.id, host: c.host, path: c.path })), cloneId ? [cloneId] : null)} />
      )}
      {flow.sheet}
      {deletion.sheet}
    </>
  );
}

function RepoTabs({ repo: r, search, hasForge, onPlan, onDelete }: { repo: RepositoryDetail; search: RepoSearch; hasForge: boolean; onPlan: (p: PlanInput) => void; onDelete: (cloneId?: string) => void }) {
  const navigate = useNavigate({ from: Route.fullPath });
  const key = r.key;
  const { tab } = search;
  const worktreeCount = r.clones.reduce((s, c) => s + c.worktrees.length, 0);
  return (
    <>
      <About repo={r} />
      <Tabs value={tab === "prs" && !hasForge ? "overview" : tab} onValueChange={(v) => { const t = TABS.find((x) => x === v); if (t) void navigate({ search: (p) => ({ ...p, tab: t, page: 1 }), replace: true }); }} className="mt-4 gap-4">
        <ScrollTabsList>
          <TabsTrigger value="overview" className="px-2 md:px-3">{m.repos.tabs.overview}</TabsTrigger>
          <TabsTrigger value="branches" className="px-2 md:px-3">{m.repos.tabs.branches} <Count n={r.branches.length} /></TabsTrigger>
          <TabsTrigger value="worktrees" className="px-2 md:px-3">{m.repos.tabs.worktrees} <Count n={worktreeCount} /></TabsTrigger>
          {hasForge && <TabsTrigger value="prs" className="px-2 md:px-3">{m.repos.tabs.prs}</TabsTrigger>}
          <TabsTrigger value="landings" className="px-2 md:px-3">{m.repos.tabs.landings}</TabsTrigger>
        </ScrollTabsList>
        <TabsContent value="overview" className="flex flex-col gap-6">
          <Overview repo={r} onPlan={onPlan} onDelete={onDelete} />
        </TabsContent>
        <TabsContent value="branches">
          <Branches repo={r} />
        </TabsContent>
        <TabsContent value="worktrees" className="flex flex-col gap-2">
          <Worktrees repo={r} onPlan={onPlan} />
        </TabsContent>
        {hasForge && (
          <TabsContent value="prs" className="flex flex-col gap-3">
            <SyncPrsButton repo={key} className="items-start" />
            <Prs repo={key} />
          </TabsContent>
        )}
        <TabsContent value="landings" className="flex flex-col gap-3">
          {tab === "landings" && <Landings repo={r} search={search} update={(patch) => void navigate({ search: (p) => ({ ...p, ...patch }) })} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function MuteButton({ repositoryId, muted }: { repositoryId: string; muted: boolean }) {
  const mute = useSetMuted();
  const set = (next: boolean) => mute.mutate({ repositoryId, muted: next });
  return (
    <IconButton label={muted ? m.mute.unmuteRepo : m.mute.muteRepo} aria-pressed={muted} disabled={mute.isPending} onClick={() => set(!muted)}>
      {muted ? <BellOffIcon /> : <BellIcon />}
    </IconButton>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{n}</span>;
}

function About({ repo }: { repo: RepositoryDetail }) {
  const summary = repo.about?.description || repo.clones.map((c) => readmeSummary(c.about, 400)).find(Boolean);
  if (!summary) return null;
  return <p className="max-w-prose text-sm text-pretty text-muted-foreground">{summary}</p>;
}

/** Base SHA as one clone sees it (remote-tracking ref or local trunk). */
const baseSha = (c: Clone, ref: string) => c.remoteBranches.find((b) => b.name === ref)?.sha ?? c.branches.find((b) => b.name === ref)?.sha ?? "";

function Worktrees({ repo, onPlan }: { repo: RepositoryDetail; onPlan: (p: PlanInput) => void }) {
  const verdicts = useMemo(() => new Map(repo.branches.map((b) => [b.name, b.verdict])), [repo.branches]);
  const rows = repo.clones.flatMap((c) => c.worktrees.map((w) => ({ clone: c, w: { ...w, id: c.host + ":" + w.path, name: w.path, host: c.host, repo: repo.key } satisfies WorktreeItem })));
  if (!rows.length) return <EmptyState>{m.repos.noWorktrees}</EmptyState>;
  return rows.map(({ clone: c, w }) => {
    const action = canPrune(w) ? (
      <Button variant="outline" className="h-11 md:h-8" onClick={() => onPlan({ kind: "prune-worktree", targets: [{ host: c.host, repo: c.path, worktree: w.path }] })}>
        <EraserIcon />{m.worktrees.prune}
      </Button>
    ) : canSwitchToBase(w, w.branch ? verdicts.get(w.branch) : undefined) ? (
      <Button variant="outline" className="h-11 md:h-8" onClick={() => onPlan({ kind: "switch-to-base", targets: [{ host: c.host, repo: c.path, branch: w.branch ?? undefined, worktree: w.path }] })}>
        <UndoIcon />{m.worktrees.switchToBase}
      </Button>
    ) : undefined;
    return <WorktreeCard key={w.id} showRepo={false} worktree={w} actions={action} />;
  });
}

function Landings({ repo, search, update }: { repo: RepositoryDetail; search: RepoSearch; update: (patch: Partial<RepoSearch>) => void }) {
  const bases = [...new Set(repo.clones.flatMap((c) => c.bases.map(stripRemote)))].sort();
  const live = useMemo(() => new Set(repo.branches.map((b) => b.id)), [repo.branches]);
  const baseIds = useMemo(() => new Set(repo.branches.filter((b) => b.verdict === "base").map((b) => b.id)), [repo.branches]);
  const landings = useQuery({ ...q.landings({ repo: repo.key, includeMuted: true, base: search.base || undefined, page: search.page, pageSize: LANDINGS_PAGE }), placeholderData: keepPreviousData });
  return (
    <>
      {bases.length > 1 && (
        <FilterField label={m.provenance.base} labelFor="landing-base" className="max-w-xs">
          <OptionSelect id="landing-base" value={search.base} onChange={(base) => update({ base, page: 1 })} anyLabel={m.provenance.allBases} options={bases.map((b) => ({ value: b, label: b }))} />
        </FilterField>
      )}
      {landings.error ? (
        <ErrorState error={landings.error} onRetry={() => void landings.refetch()} />
      ) : !landings.data ? (
        <ListSkeleton />
      ) : !landings.data.items.length ? (
        <EmptyState>{m.provenance.landingsEmpty}</EmptyState>
      ) : (
        <>
          <RowList className={cn(landings.isPlaceholderData && "opacity-60 transition-opacity")}>
            {landings.data.items.map((l) => <LandingRow key={l.sha} repo={repo.key} landing={l} liveIds={live} baseIds={baseIds} />)}
          </RowList>
          <Pagination page={search.page} total={landings.data.total} pageSize={LANDINGS_PAGE} onPage={(page) => update({ page })} />
        </>
      )}
    </>
  );
}

/** "Change URL" for one remote on every clone that has it (e.g. the repository moved to another forge). */
function RemoteUrlSheet({ remote, targets, current, onClose, onPlan }: { remote: string | null; targets: ActionTarget[]; current: string; onClose: () => void; onPlan: (p: PlanInput) => void }) {
  const [url, setUrl] = useState(current);
  const valid = url.trim() !== "" && url.trim() !== current && !url.trim().startsWith("-");
  return (
    <Sheet open={remote !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{m.actions.kind["set-remote-url"]}: {remote}</SheetTitle>
          <SheetDescription>{m.actions.hint["set-remote-url"]}</SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onClose();
            onPlan({ kind: "set-remote-url", targets: targets.map((t) => ({ ...t, url: url.trim() })) });
          }}
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <FilterField label={m.actions.newUrl} labelFor="remote-url">
              <Input id="remote-url" className="h-11 font-mono md:h-9" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
            </FilterField>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {targets.map((t) => <li key={t.host + t.repo}><Mono>{t.host}:{t.repo}</Mono></li>)}
            </ul>
          </div>
          <SheetFooter className="border-t">
            <Button type="submit" className="h-11 w-full md:h-9" disabled={!valid}>{m.actions.review}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Overview({ repo, onPlan, onDelete }: { repo: RepositoryDetail; onPlan: (p: PlanInput) => void; onDelete: (cloneId?: string) => void }) {
  const [editRemote, setEditRemote] = useState<string | null>(null);
  const bases = [...new Set(repo.clones.flatMap((c) => c.bases))];
  const remotes = [...new Set(repo.clones.flatMap((c) => c.remotes.map((r) => r.name)))];
  const stashes = repo.clones.flatMap((c) => c.stashes.map((s) => ({ host: c.host, ...parseStash(s) })));
  const errors = repo.clones.flatMap((c) => c.errors.map((e) => `${c.host}: ${e}`));
  return (
    <>
      <Section title={m.repos.clonesTitle} id="clones">
        <div className="grid gap-2 lg:grid-cols-2">
          {repo.clones.map((c) => {
            const origin = c.remotes.find((r) => r.name === "origin") ?? c.remotes[0];
            const changed = c.worktrees.filter(hasChanges).length;
            const missing = c.worktrees.filter(isMissing).length;
            const behind = c.branches.filter(canFastForward);
            return (
              <Card key={c.host + c.path} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.host}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.repos.branches(c.branches.length)} · {m.repos.remoteBranches(c.remoteBranches.length)}
                  </span>
                </div>
                <KV rows={[
                  [m.repos.path, <Mono key="p">{c.path}</Mono>],
                  [m.repos.origin, origin ? <Mono key="o">{origin.url}</Mono> : <span key="o" className="text-muted-foreground">{m.repos.noRemotes}</span>],
                  [m.repos.base, c.bases[0] ? <Mono key="b">{c.bases[0]}</Mono> : "—"],
                  [m.nav.worktrees, <span key="w">{c.worktrees.length}{changed ? ` · ${changed} ${m.worktrees.status.changes.toLowerCase()}` : ""}{missing ? ` · ${missing} ${m.worktrees.status.missing.toLowerCase()}` : ""}</span>],
                ]} />
                {behind.map((b) => (
                  <div key={b.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2 text-sm">
                    <span>{m.repos.behindBase(b.name, b.base ?? "", b.behind)}</span>
                    <Button variant="outline" className="h-11 md:h-8" onClick={() => onPlan({ kind: "fast-forward-base", targets: [{ host: c.host, repo: c.path, branch: b.name }] })}>
                      <FastForwardIcon />{m.branches.fastForward(b.base ?? "")}
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="h-11 self-end text-destructive hover:text-destructive md:h-8" aria-label={m.repos.deleteCloneLabel(c.host, c.path)} onClick={() => onDelete(c.id)}>
                  <Trash2Icon />{m.repos.deleteClone}
                </Button>
              </Card>
            );
          })}
        </div>
      </Section>

      {remotes.length > 0 && (
        <Section title={m.repos.remotes} id="remotes">
          <RowList>
            {remotes.map((name) => {
              const per = repo.clones.map((c) => ({ host: c.host, r: c.remotes.find((x) => x.name === name) }));
              const urls = [...new Set(per.map((p) => p.r?.url).filter(Boolean))];
              const push = [...new Set(per.map((p) => p.r?.pushurl).filter((u) => u && !urls.includes(u)))];
              const defaults = [...new Set(per.map((p) => p.r?.defaultBranch).filter(Boolean))];
              return (
                <li key={name} className="flex flex-col gap-1.5 p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{name}</span>
                    {defaults.map((d) => <Pill key={d}>{m.repos.defaultBranch}: {d}</Pill>)}
                    <Button variant="ghost" size="sm" className="ml-auto h-11 md:h-7" onClick={() => setEditRemote(name)}>
                      <PencilIcon />{m.repos.changeUrl}
                    </Button>
                  </span>
                  {urls.map((u) => <Mono key={u}>{u}</Mono>)}
                  {push.map((u) => <Mono key={u} className="text-muted-foreground">{m.repos.push}: {u}</Mono>)}
                  <span className="flex flex-wrap gap-1">
                    {per.map(({ host, r }) => (
                      <Pill key={host} t={!r ? "neutral" : r.fetchError ? "bad" : "good"} title={r?.fetchError ?? undefined}>
                        {host}{!r ? `: ${m.none.toLowerCase()}` : r.fetchError ? `: ${m.repos.fetchFailed}` : ""}
                      </Pill>
                    ))}
                  </span>
                  {per.filter((p) => p.r?.fetchError).map(({ host, r }) => (
                    <p key={host} className="font-mono text-xs break-all text-destructive">{host}: {r!.fetchError}</p>
                  ))}
                </li>
              );
            })}
          </RowList>
        </Section>
      )}

      {bases.length > 0 && (
        <Section title={m.repos.bases} id="bases">
          <RowList>
            {bases.map((ref) => {
              const per = repo.clones.filter((c) => c.bases.includes(ref)).map((c) => ({ host: c.host, path: c.path, sha: baseSha(c, ref) }));
              const odd = divergingShas(per.map((p) => p.sha).filter(Boolean));
              return (
                <li key={ref} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="font-mono font-medium">{ref}</span>
                  <span className="flex flex-wrap gap-1" title={odd.size ? m.repos.shasDiffer : undefined}>
                    {per.map((p) => (
                      <span key={p.host + p.path} className={cn("inline-flex h-6 items-center gap-1 rounded-md border px-1.5 font-mono text-[11px]", odd.has(p.sha) ? "border-warning bg-warning/15" : "text-muted-foreground")}>
                        <span className="font-sans font-medium">{p.host}</span>{shortSha(p.sha) || "—"}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </RowList>
        </Section>
      )}

      <Section title={m.repos.stashes} id="stashes">
        {stashes.length ? (
          <RowList>
            {stashes.map((s) => (
              <li key={s.host + s.ref} className="flex flex-col gap-0.5 p-3 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{s.host}: {s.ref}</span>
                  <RelativeTime iso={s.date} className="text-xs text-muted-foreground" />
                </span>
                <span className="break-words">{s.subject}</span>
              </li>
            ))}
          </RowList>
        ) : (
          <p className="text-sm text-muted-foreground">{m.repos.noStashes}</p>
        )}
      </Section>

      {errors.length > 0 && (
        <Section title={m.repos.errors} id="errors">
          {errors.map((e, i) => <p key={i} className="font-mono text-xs break-all text-destructive">{e}</p>)}
        </Section>
      )}

      <ForgeLink repo={repo.key} />

      <Section title={m.repos.dangerZone} id="danger">
        <Card className="flex flex-col gap-3 border-destructive/40 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-prose text-sm text-muted-foreground">{m.repos.dangerText}</p>
          <Button variant="outline" className="h-11 shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive md:h-9" onClick={() => onDelete()}>
            <Trash2Icon />{m.repos.deleteFromDisk}
          </Button>
        </Card>
      </Section>
      {editRemote !== null && (
        <RemoteUrlSheet
          key={editRemote}
          remote={editRemote}
          current={repo.clones.flatMap((c) => c.remotes).find((r) => r.name === editRemote)?.url ?? ""}
          targets={repo.clones.filter((c) => c.remotes.some((r) => r.name === editRemote)).map((c) => ({ host: c.host, repo: c.path, remote: editRemote }))}
          onClose={() => setEditRemote(null)}
          onPlan={onPlan}
        />
      )}
    </>
  );
}

function ForgeLink({ repo }: { repo: string }) {
  if (repo.startsWith("local/") || repo.startsWith("file:")) return null;
  return (
    <a href={`https://${repo}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-muted-foreground underline-offset-4 hover:underline md:min-h-0">
      <ExternalLinkIcon className="size-4" />
      {repo}
    </a>
  );
}

function Branches({ repo }: { repo: RepositoryDetail }) {
  const groups = useMemo(() => groupByVerdict(repo.branches), [repo.branches]);
  const max = useMemo(() => divergenceMax(repo.branches), [repo.branches]);
  const prs = usePrsByBranch(repo.key);
  if (!groups.length) return <EmptyState>{m.repos.noBranches}</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <Collapsible key={g.verdict} defaultOpen={g.verdict !== "base"} className="flex flex-col gap-2">
          <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 text-left text-sm font-semibold md:min-h-8">
            <Dot className={cn("size-2.5", verdictBg[g.verdict])} />
            {m.verdict[g.verdict]}
            <span className="font-normal text-muted-foreground">{g.items.length}</span>
            <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <RowList>
              {g.items.map((b) => <BranchRow key={b.id} branch={b} max={max} showRepo={false} pr={prs.get(b.id)} />)}
            </RowList>
          </CollapsibleContent>
        </Collapsible>
      ))}
      <Link to="/branches" search={{ repo: repo.key }} className="min-h-11 self-start text-sm text-muted-foreground underline-offset-4 hover:underline md:min-h-0">
        {m.nav.branches} →
      </Link>
    </div>
  );
}

function Prs({ repo }: { repo: string }) {
  const prs = useQuery(q.prs({ repo, state: "all", includeMuted: true, page: 1, pageSize: 50 }));
  if (prs.isPending) return <ListSkeleton rows={3} />;
  if (prs.error) return <ErrorState error={prs.error} onRetry={() => void prs.refetch()} />;
  if (!prs.data.items.length) return <EmptyState>{m.prs.empty}</EmptyState>;
  return <RowList>{prs.data.items.map((p) => <PrRow key={p.id} pr={p} showRepo={false} />)}</RowList>;
}
