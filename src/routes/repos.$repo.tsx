import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useMemo } from "react";
import { Dot, KV, Mono, Pill, RelativeTime, verdictBg } from "@/components/domain";
import { NewRunButton } from "@/components/new-run";
import { Card, PageHeader, Section } from "@/components/page-header";
import { BranchRow, divergenceMax, PrRow, RowList, usePrsByBranch, WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton, PageSkeleton } from "@/components/states";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Clone, RepositoryDetail, WorktreeItem } from "@/lib/api/types";
import { parseStash, readmeSummary, repoName, repoOwner, shortSha } from "@/lib/format";
import { q } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { repoSearch, stripDefaults, validator } from "@/lib/search";
import { cn } from "@/lib/utils";
import { divergingShas, groupByVerdict } from "@/lib/verdicts";
import { m } from "@/messages";

export const Route = createFileRoute("/repos/$repo")({
  validateSearch: validator(repoSearch),
  search: { middlewares: [stripDefaults(repoSearch)] },
  head: (ctx: { params: { repo: string } }) => title(repoName(ctx.params.repo), m.repos.title),
  loader: (ctx) => prefetch(ctx.context.queryClient, q.repo(ctx.params.repo)),
  component: RepoPage,
});

const TABS = ["overview", "branches", "worktrees", "prs"] as const;

function RepoPage(): React.ReactNode {
  const { repo: key } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const repo = useQuery(q.repo(key));
  const settings = useQuery(q.settings());
  const hasForge = settings.data?.forges.some((f) => key.startsWith(f.host + "/")) ?? false;
  const header = (
    <PageHeader
      back="/repos"
      title={repoName(key)}
      subtitle={repoOwner(key)}
      actions={<NewRunButton target={{ repo: key, label: key }} />}
    />
  );
  if (repo.isPending) return <>{header}<PageSkeleton /></>;
  if (repo.error) return <>{header}<ErrorState error={repo.error} onRetry={() => void repo.refetch()} /></>;
  const r = repo.data;
  if (!r.clones.length) return <>{header}<EmptyState>{m.notFound}</EmptyState></>;
  const worktreeCount = r.clones.reduce((s, c) => s + c.worktrees.length, 0);
  return (
    <>
      {header}
      <About repo={r} />
      <Tabs value={tab} onValueChange={(v) => { const t = TABS.find((x) => x === v); if (t) void navigate({ search: (p) => ({ ...p, tab: t }), replace: true }); }} className="mt-4 gap-4">
        <TabsList className="h-11 w-full md:h-9 md:w-auto">
          <TabsTrigger value="overview" className="px-2 md:px-3">{m.repos.tabs.overview}</TabsTrigger>
          <TabsTrigger value="branches" className="px-2 md:px-3">{m.repos.tabs.branches} <Count n={r.branches.length} /></TabsTrigger>
          <TabsTrigger value="worktrees" className="px-2 md:px-3">{m.repos.tabs.worktrees} <Count n={worktreeCount} /></TabsTrigger>
          {hasForge && <TabsTrigger value="prs" className="px-2 md:px-3">{m.repos.tabs.prs}</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-6">
          <Overview repo={r} />
        </TabsContent>
        <TabsContent value="branches">
          <Branches repo={r} />
        </TabsContent>
        <TabsContent value="worktrees" className="flex flex-col gap-2">
          {r.clones.flatMap((c) => c.worktrees.map((w) => <WorktreeCard key={c.host + w.path} showRepo={false} worktree={{ ...w, id: c.host + ":" + w.path, name: w.path, host: c.host, repo: r.key } satisfies WorktreeItem} />))}
        </TabsContent>
        {hasForge && (
          <TabsContent value="prs">
            <Prs repo={key} />
          </TabsContent>
        )}
      </Tabs>
    </>
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

function Overview({ repo }: { repo: RepositoryDetail }) {
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
            const dirty = c.worktrees.filter((w) => w.dirty).length;
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
                  [m.nav.worktrees, <span key="w">{c.worktrees.length}{dirty ? ` · ${dirty} ${m.flag.dirty.toLowerCase()}` : ""}</span>],
                ]} />
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
  const prs = useQuery(q.prs({ repo, state: "all", page: 1, pageSize: 50 }));
  if (prs.isPending) return <ListSkeleton rows={3} />;
  if (prs.error) return <ErrorState error={prs.error} onRetry={() => void prs.refetch()} />;
  if (!prs.data.items.length) return <EmptyState>{m.prs.empty}</EmptyState>;
  return <RowList>{prs.data.items.map((p) => <PrRow key={p.id} pr={p} showRepo={false} />)}</RowList>;
}
