import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArchiveIcon, GitPullRequestCreateIcon, Loader2Icon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ActionFlowSheet } from "@/components/action-flow";
import { DivergenceBar, FlagChips, KV, Mono, Pill, PrStateBadge, RelativeTime, StateBadge, VerdictBadge } from "@/components/domain";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { NewRunButton } from "@/components/new-run";
import { Card, PageHeader, Section } from "@/components/page-header";
import { leadClone, RowList, usePrsByBranch, WorktreeCard } from "@/components/rows";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseBranchId } from "@/lib/api/adapters";
import { createPullRequest } from "@/lib/api/client";
import type { BranchClone, BranchGroup, Clone, PlanInput, Thread, WorktreeItem } from "@/lib/api/types";
import { parseCommit, parseShortstat, repoName, shortSha, stripRemote } from "@/lib/format";
import { q } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { cn } from "@/lib/utils";
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
  const [plan, setPlan] = useState<PlanInput | null>(null);
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
  if (!b) return <>{header()}<EmptyState>{m.branches.notFound}</EmptyState></>;
  const pr = prs.get(b.id);
  const hasForge = settings.data?.forges.some((f) => b.repo.startsWith(f.host + "/")) ?? false;
  const clones = repo.data?.clones ?? [];
  const cloneOf = (c: BranchClone) => clones.find((x) => x.host === c.host && x.path === c.path);
  const worktrees = b.clones.flatMap((c) => (cloneOf(c)?.worktrees ?? []).filter((w) => w.branch === b.name).map((w): WorktreeItem => ({ ...w, id: c.host + ":" + w.path, name: w.path, host: c.host, repo: b.repo })));
  const threads = b.clones.flatMap((c) => threadsFor(cloneOf(c), b.name).map((t) => ({ host: c.host, ...t })));
  const operations = worktrees.some((w) => w.operations.length > 0);

  return (
    <>
      {header(b)}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{m.verdictHelp[b.verdict]}</p>
          <span className="flex flex-wrap gap-1">
            {pr && <Link to="/prs/$pr" params={{ pr: pr.id }}><PrStateBadge pr={pr} /></Link>}
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
            {hasForge && !pr && b.verdict !== "base" && b.verdict !== "delete" && (
              <Button variant="outline" className="h-11 md:h-9" onClick={() => setCreatePr(true)}>
                <GitPullRequestCreateIcon />{m.branches.createPr}
              </Button>
            )}
            <NewRunButton target={{ repo: b.repo, branchId: b.id, label: `${repoName(b.repo)} · ${b.name}` }} />
          </div>
        </div>

        <Section title={m.branches.perClone} id="clones">
          <div className="grid gap-3 xl:grid-cols-2">
            {b.clones.map((c) => <CloneCard key={c.host + c.path} c={c} max={Math.max(10, ...b.clones.flatMap((x) => [x.ahead, x.behind]))} />)}
          </div>
        </Section>

        {worktrees.length > 0 && (
          <Section title={m.branches.worktrees} id="worktrees">
            <div className="flex flex-col gap-2">{worktrees.map((w) => <WorktreeCard key={w.id} worktree={w} showRepo={false} />)}</div>
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
      <ActionFlowSheet request={plan} onClose={() => setPlan(null)} />
      {hasForge && <CreatePrSheet branch={b} open={createPr} onOpenChange={setCreatePr} />}
    </>
  );
}

function threadsFor(clone: Clone | undefined, branch: string): Thread[] {
  if (!clone) return [];
  const paths = new Set(clone.worktrees.filter((w) => w.branch === branch).map((w) => w.path));
  return clone.threads.filter((t) => t.branch === branch || (t.worktree && paths.has(t.worktree)));
}

function CloneCard({ c, max }: { c: BranchClone; max: number }) {
  const commits = c.commits.map(parseCommit);
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
      ]} />
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
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">{m.branches.commits}</h3>
        {commits.length ? (
          <ul className="flex flex-col divide-y text-sm">
            {commits.map((k) => (
              <li key={k.sha} className="flex items-baseline gap-2 py-1.5">
                <Mono className="shrink-0 text-muted-foreground">{k.sha}</Mono>
                <span className="min-w-0 flex-1 break-words">{k.subject}</span>
                <RelativeTime iso={k.date} className="shrink-0 text-xs text-muted-foreground" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{m.branches.noCommits}</p>
        )}
        {commits.length >= 25 && <p className="text-xs text-muted-foreground">{m.branches.commitsTruncated}</p>}
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
