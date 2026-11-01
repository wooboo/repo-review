import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArchiveIcon, EraserIcon, ExternalLinkIcon, FastForwardIcon, GitPullRequestCreateIcon, Loader2Icon, Trash2Icon, UndoIcon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { useActionFlow } from "@/components/action-flow";
import { DivergenceBar, FlagChips, KV, LandedBadge, Mono, Pill, PrStateBadge, RelativeTime, StateBadge, VerdictBadge } from "@/components/domain";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { NewRunButton } from "@/components/new-run";
import { Card, PageHeader, Section } from "@/components/page-header";
import { leadClone, RowList, usePrsByBranch, WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, ListSkeleton, PageSkeleton } from "@/components/states";
import { HistoryRow } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseBranchId } from "@/lib/api/ids";
import { createPullRequest } from "@/lib/api/client";
import type { BranchClone, BranchGroup, Clone, LandedVia, PlanInput, Thread, WorktreeItem } from "@/lib/api/types";
import { parseShortstat, repoName, shortSha, stripRemote } from "@/lib/format";
import { branchLanding, commitsToReview, commitUrl } from "@/lib/provenance";
import { q } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { cn } from "@/lib/utils";
import { canFastForward, canPrune, canPush, canSwitchToBase } from "@/lib/worktrees";
import { m } from "@/messages";

export const Route = createFileRoute("/branches/$id")({
  head: ({ params }) => title(parseBranchId(params.id)?.name ?? params.id, m.branches.title),
  loader: ({ context, params }) => prefetch(context.queryClient, q.branch(params.id)),
  component: BranchPage,
});

const INTEGRATED = new Set(["delete", "check"]);
const ARCHIVABLE = new Set(["unmerged", "local-only", "pr-closed", "pr-merged-changed"]);

function BranchPage() {
  const { id } = Route.useParams();
  const ref = parseBranchId(id);
  const branch = useQuery(q.branch(id));
  const repo = useQuery({ ...q.repo(ref?.repo ?? ""), enabled: !!ref });
  const settings = useQuery(q.settings());
  const prs = usePrsByBranch(ref?.repo);
  const flow = useActionFlow();
  const setPlan = (p: PlanInput) => flow.start(p);
  const [createPr, setCreatePr] = useState(false);
  const header = (b?: BranchGroup) => (
    <PageHeader
      back="/branches"
      title={ref?.name ?? id}
      subtitle={ref && <Link to="/repos/$repo" params={{ repo: ref.repo }} className="underline-offset-4 hover:underline">{ref.repo}</Link>}
      actions={b && <VerdictBadge verdict={b.verdict} />}
    />
  );
  if (branch.isPending) return <>{header()}<PageSkeleton /></>;
  if (branch.error) return <>{header()}<ErrorState error={branch.error} onRetry={() => void branch.refetch()} /></>;
  const b = branch.data;
  if (!b) return <>{header()}{ref ? <GoneBranch repo={ref.repo} name={ref.name} /> : <EmptyState>{m.branches.notFound}</EmptyState>}</>;
  const pr = prs.get(b.id);
  const hasForge = settings.data?.forges.some((f) => b.repo.startsWith(f.host + "/")) ?? false;
  const clones = repo.data?.clones ?? [];
  const cloneOf = (c: BranchClone) => clones.find((x) => x.host === c.host && x.path === c.path);
  const worktrees = b.clones.flatMap((c) =>
    (cloneOf(c)?.worktrees ?? []).filter((w) => w.branch === b.name).map((w) => ({ clonePath: c.path, item: { ...w, id: c.host + ":" + w.path, name: w.path, host: c.host, repo: b.repo } satisfies WorktreeItem })),
  );
  const threads = b.clones.flatMap((c) => threadsFor(cloneOf(c), b.name).map((t) => ({ host: c.host, ...t })));
  const operations = worktrees.some((w) => w.item.operations.length > 0);
  const landed = branchLanding(b);
  const pushable = b.clones.filter(canPush);
  const worktreeAction = ({ clonePath, item: w }: (typeof worktrees)[number]) =>
    canSwitchToBase(w, b.verdict) ? (
      <Button variant="outline" className="h-11 md:h-8" onClick={() => setPlan({ kind: "switch-to-base", targets: [{ host: w.host, repo: clonePath, branch: b.name, worktree: w.path }] })}>
        <UndoIcon />{m.worktrees.switchToBase}
      </Button>
    ) : canPrune(w) ? (
      <Button variant="outline" className="h-11 md:h-8" onClick={() => setPlan({ kind: "prune-worktree", targets: [{ host: w.host, repo: clonePath, worktree: w.path }] })}>
        <EraserIcon />{m.worktrees.prune}
      </Button>
    ) : undefined;

  return (
    <>
      {header(b)}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{m.verdictHelp[b.verdict]}</p>
          <span className="flex flex-wrap gap-1">
            {pr && pr.id !== landed?.pullRequestId && <Link to="/prs/$pr" params={{ pr: pr.id }}><PrStateBadge pr={pr} /></Link>}
            <FlagChips branch={b} extra={[...(operations ? [{ key: "operation" as const, t: "bad" as const }] : []), ...(threads.length ? [{ key: "threads" as const, t: "warn" as const }] : [])]} />
          </span>
          <div className="flex flex-wrap gap-2">
            {INTEGRATED.has(b.verdict) && (
              <Button variant="destructive" className="h-11 md:h-9" onClick={() => setPlan({ kind: "delete-branch", branchIds: [b.id] })}>
                <Trash2Icon />{m.branches.delete}
              </Button>
            )}
            {ARCHIVABLE.has(b.verdict) && (
              <Button variant="destructive" className="h-11 md:h-9" onClick={() => setPlan({ kind: "archive-and-delete", branchIds: [b.id] })}>
                <ArchiveIcon />{m.branches.archiveDelete}
              </Button>
            )}
            {pushable.length > 0 && (
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setPlan({ kind: "push-branch", targets: pushable.map((c) => ({ host: c.host, repo: c.path, branch: b.name })) })}>
                <UploadIcon />{m.branches.push}
              </Button>
            )}
            {hasForge && !pr && !landed && b.verdict !== "base" && b.verdict !== "delete" && (
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setCreatePr(true)}>
                <GitPullRequestCreateIcon />{m.branches.createPr}
              </Button>
            )}
            <NewRunButton target={{ repo: b.repo, branchId: b.id, label: `${repoName(b.repo)} · ${b.name}` }} />
          </div>
        </div>

        {landed && <LandedSection repo={b.repo} landed={landed} />}

        <Section title={m.branches.perClone} id="clones">
          <div className="grid gap-3 xl:grid-cols-2">
            {b.clones.map((c) => (
              <CloneCard key={c.host + c.path} c={c} showLanded={!landed} max={Math.max(10, ...b.clones.flatMap((x) => [x.ahead, x.behind]))}
                onFastForward={canFastForward(c) ? () => setPlan({ kind: "fast-forward-base", targets: [{ host: c.host, repo: c.path, branch: c.name }] }) : undefined} />
            ))}
          </div>
        </Section>

        {worktrees.length > 0 && (
          <Section title={m.branches.worktrees} id="worktrees">
            <div className="flex flex-col gap-2">{worktrees.map((w) => <WorktreeCard key={w.item.id} worktree={w.item} showRepo={false} actions={worktreeAction(w)} />)}</div>
          </Section>
        )}

        {threads.length > 0 && (
          <Section title={m.branches.threads} id="threads">
            <RowList>
              {threads.map((t) => (
                <li key={t.host + t.id} className="flex items-start justify-between gap-2 p-3 text-sm">
                  <span className="min-w-0 break-words">{t.title}</span>
                  <Pill t={/run|wait|start|queue|prep/i.test(t.status) ? "busy" : "neutral"}>{t.status}</Pill>
                </li>
              ))}
            </RowList>
          </Section>
        )}
      </div>
      {flow.sheet}
      {hasForge && <CreatePrSheet branch={b} open={createPr} onOpenChange={setCreatePr} />}
    </>
  );
}

/** A branch the inventory no longer has: its history entries (where it was, where it landed), if any. */
function GoneBranch({ repo, name }: { repo: string; name: string }) {
  const history = useQuery(q.history({ repo, gone: true, page: 1, pageSize: 200 }));
  const rows = (history.data?.items ?? []).filter((h) => h.branch === name);
  if (history.isPending) return <ListSkeleton rows={2} />;
  if (!rows.length) return <EmptyState>{m.branches.notFound}</EmptyState>;
  return (
    <Section title={m.branches.history} id="history">
      <RowList>{rows.map((h) => <HistoryRow key={`${h.host}:${h.clonePath}@${h.sha}`} item={h} showRepo={false} />)}</RowList>
    </Section>
  );
}

function threadsFor(clone: Clone | undefined, branch: string): Thread[] {
  if (!clone) return [];
  const paths = new Set(clone.worktrees.filter((w) => w.branch === branch).map((w) => w.path));
  return clone.threads.filter((t) => t.branch === branch || (t.worktree && paths.has(t.worktree)));
}

/** "Landed via #12 (squash) as abc1234", with links to the PR and the merge commit. */
function LandedSection({ repo, landed }: { repo: string; landed: LandedVia }) {
  const method = m.provenance.method[landed.method];
  const sha = landed.mergeCommitSha ?? landed.matchedSha;
  const url = commitUrl(repo, sha);
  return (
    <Section title={m.provenance.title} id="landed">
      <Card className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <span>{m.provenance.landedViaPrefix}</span>
          <Link to="/prs/$pr" params={{ pr: landed.pullRequestId }} className="font-medium underline-offset-4 hover:underline">#{landed.number}</Link>
          {method && <span className="text-muted-foreground">({method})</span>}
          {sha && (
            <>
              <span>{m.provenance.as}</span>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline">
                  {shortSha(sha)}<ExternalLinkIcon className="size-3" aria-hidden="true" />
                </a>
              ) : <Mono>{shortSha(sha)}</Mono>}
            </>
          )}
          <a href={landed.url} target="_blank" rel="noreferrer" aria-label={m.openExternal} title={m.openExternal} className="inline-flex size-11 items-center justify-center text-muted-foreground hover:text-foreground md:size-6">
            <ExternalLinkIcon className="size-4" />
          </a>
        </p>
        {landed.extraCommits > 0 && (
          <p className="flex flex-col gap-1 text-sm">
            <span><LandedBadge landed={landed} /></span>
            <span className="text-muted-foreground">{m.provenance.onlyExtra(landed.number)}</span>
          </p>
        )}
      </Card>
    </Section>
  );
}

function CloneCard({ c, max, showLanded, onFastForward }: { c: BranchClone; max: number; showLanded: boolean; onFastForward?: () => void }) {
  const review = commitsToReview(c);
  const commits = review.commits;
  const diff = parseShortstat(c.diffstat);
  const residual = parseShortstat(c.residual);
  const remotes = Object.entries(c.onRemotes);
  const bases = Object.entries(c.vsBases);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{c.host}</span> <Mono className="text-muted-foreground">{c.path}</Mono>
        </span>
        <StateBadge state={c.state} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm">
          <span className="break-words">{c.subject}</span>
          <span className="block text-xs text-muted-foreground">{c.author} · <RelativeTime iso={c.date} /></span>
        </span>
        <DivergenceBar behind={c.behind} ahead={c.ahead} base={c.base} max={max} />
      </div>
      <KV rows={[
        [m.branches.sha, <Mono key="s">{c.sha}</Mono>],
        [m.branches.base, c.base ? <span key="b"><Mono>{c.base}</Mono> <Mono className="text-muted-foreground">{shortSha(c.baseSha)}</Mono></span> : m.branches.noBase],
        [m.branches.mergeBase, <Mono key="mb">{shortSha(c.mergeBase) || "—"}</Mono>],
        [m.branches.upstream, c.upstream ? <span key="u"><Mono>{c.upstream}</Mono>{c.upstreamGone && <Pill t="warn" className="ml-1">{m.branches.gone}</Pill>}</span> : <span key="u" className="text-muted-foreground">{m.branches.noUpstream}</span>],
        [m.branches.onRemotes, remotes.length ? <span key="r" className="flex flex-wrap gap-1">{remotes.map(([r, sha]) => <Pill key={r} t={sha === c.sha ? "good" : "warn"}>{r} {shortSha(sha)}</Pill>)}</span> : "—"],
        [m.branches.unpushed, <span key="up" className={cn("tabular-nums", c.unpushed > 0 && "font-medium text-v-local-only")}>{c.unpushed}</span>],
        [m.branches.unique, <span key="un" className="tabular-nums">{c.unique}</span>],
        ...(diff ? [[m.branches.diffstat, <DiffStat key="d" s={diff} />] as [string, React.ReactNode]] : []),
        ...(residual ? [[m.branches.residual, <DiffStat key="rs" s={residual} />] as [string, React.ReactNode]] : []),
        ...(c.squashCommit ? [[m.branches.squash, <Mono key="sq">{shortSha(c.squashCommit)}</Mono>] as [string, React.ReactNode]] : []),
        ...(c.containedIn.length ? [[m.branches.containedIn, <span key="ci" className="flex flex-wrap gap-1">{c.containedIn.map((r) => <Pill key={r}>{r}</Pill>)}</span>] as [string, React.ReactNode]] : []),
        ...(showLanded && c.landedVia ? [[m.provenance.title, <Link key="lv" to="/prs/$pr" params={{ pr: c.landedVia.pullRequestId }}><LandedBadge landed={c.landedVia} /></Link>] as [string, React.ReactNode]] : []),
      ]} />
      {onFastForward && c.base && (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-muted/50 p-2 text-sm">
          <span>{m.repos.behindBase(c.name, c.base, c.behind)}</span>
          <Button variant="outline" className="h-11 md:h-8" onClick={onFastForward}><FastForwardIcon />{m.branches.fastForward(c.base)}</Button>
        </div>
      )}
      {bases.length > 1 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">{m.branches.vsBases}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {bases.map(([ref, d]) => (
              <li key={ref} className="flex items-center justify-between gap-2">
                <Mono className={cn(ref === c.base && "font-semibold")}>{ref}</Mono>
                <DivergenceBar behind={d.behind} ahead={d.ahead} base={ref} max={max} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">
          {review.filtered && c.landedVia ? m.provenance.after(c.landedVia.extraCommits, c.landedVia.number) : m.branches.commits}
        </h3>
        {commits.length ? (
          <ul className="flex flex-col divide-y text-sm">
            {commits.map((k) => (
              <li key={k.sha} className="flex items-baseline gap-2 py-1.5">
                <Mono className="shrink-0 text-muted-foreground">{shortSha(k.sha)}</Mono>
                <span className="min-w-0 flex-1 break-words">{k.subject}</span>
                {k.date && <RelativeTime iso={k.date} className="shrink-0 text-xs text-muted-foreground" />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{review.filtered && c.landedVia ? m.provenance.nothingExtra(c.landedVia.number) : m.branches.noCommits}</p>
        )}
        {!review.filtered && commits.length >= 25 && <p className="text-xs text-muted-foreground">{m.branches.commitsTruncated}</p>}
      </div>
    </Card>
  );
}

function DiffStat({ s }: { s: { files: number; insertions: number; deletions: number } }) {
  return (
    <span className="tabular-nums">
      {m.worktrees.fileCount(s.files)} <span className="text-success">+{s.insertions}</span> <span className="text-destructive">−{s.deletions}</span>
    </span>
  );
}

function CreatePrSheet({ branch, open, onOpenChange }: { branch: BranchGroup; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lead = leadClone(branch);
  const client = useQueryClient();
  const [titleText, setTitle] = useState(lead.subject || branch.name);
  const [body, setBody] = useState("");
  const [base, setBase] = useState(stripRemote(lead.base));
  const [draft, setDraft] = useState(false);
  const create = useMutation({
    mutationFn: () => createPullRequest({ branchId: branch.id, base: base || undefined, title: titleText, body, draft }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["prs"] });
      onOpenChange(false);
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{m.prs.createTitle}</SheetTitle>
          <SheetDescription className="break-all">{branch.name} → {base}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <FilterField label={m.prs.titleLabel} labelFor="pr-title">
            <Input id="pr-title" className="h-11 md:h-9" value={titleText} onChange={(e) => setTitle(e.target.value)} />
          </FilterField>
          <FilterField label={m.prs.baseLabel} labelFor="pr-base">
            <Input id="pr-base" className="h-11 font-mono md:h-9" value={base} onChange={(e) => setBase(e.target.value)} />
          </FilterField>
          <FilterField label={m.prs.bodyLabel} labelFor="pr-body">
            <Textarea id="pr-body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </FilterField>
          <SwitchRow label={m.prs.draftLabel}><Switch checked={draft} onCheckedChange={setDraft} /></SwitchRow>
          {create.error && <ErrorState error={create.error} />}
        </div>
        <SheetFooter className="border-t">
          <Button className="h-11 w-full md:h-9" disabled={!titleText.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <Loader2Icon className="animate-spin" /> : <GitPullRequestCreateIcon />}
            {m.prs.create}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
