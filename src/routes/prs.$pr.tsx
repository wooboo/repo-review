import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, GitMergeIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm";
import { DiffViewer } from "@/components/diff-viewer";
import { ChecksBadge, Pill, PrStateBadge, RelativeTime, ReviewBadge } from "@/components/domain";
import { FilterField, SwitchRow } from "@/components/filters/field";
import { IconButton } from "@/components/icon-button";
import { NewRunButton } from "@/components/new-run";
import { Card, PageHeader } from "@/components/page-header";
import { RowList } from "@/components/rows";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parsePullRequestId } from "@/lib/api/adapters";
import { closePullRequest, commentPullRequest, mergePullRequest } from "@/lib/api/client";
import type { MergeMethod, PullRequestDetail } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { q } from "@/lib/queries";
import { prefetch, title } from "@/lib/route-helpers";
import { prSearch, stripDefaults, validator } from "@/lib/search";
import { m } from "@/messages";

export const Route = createFileRoute("/prs/$pr")({
  validateSearch: validator(prSearch),
  search: { middlewares: [stripDefaults(prSearch)] },
  head: (ctx: { params: { pr: string } }) => {
    const ref = parsePullRequestId(ctx.params.pr);
    return title(ref ? `${repoName(ref.repo)} #${ref.number}` : ctx.params.pr, m.prs.title);
  },
  loader: (ctx) => prefetch(ctx.context.queryClient, q.pr(ctx.params.pr)),
  component: PrPage,
});

const TABS = ["conversation", "files", "diff", "checks"] as const;

function PrPage(): React.ReactNode {
  const { pr: id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const ref = parsePullRequestId(id);
  const pr = useQuery(q.pr(id));
  const header = (p?: PullRequestDetail) => (
    <PageHeader
      back="/prs"
      title={p?.title ?? (ref ? `#${ref.number}` : id)}
      subtitle={ref && <><Link to="/repos/$repo" params={{ repo: ref.repo }} className="underline-offset-4 hover:underline">{repoName(ref.repo)}</Link> #{ref.number}</>}
      actions={p && (
        <IconButton label={m.openExternal} asChild>
          <a href={p.url} target="_blank" rel="noreferrer"><ExternalLinkIcon /></a>
        </IconButton>
      )}
    />
  );
  if (pr.isPending) return <>{header()}<PageSkeleton /></>;
  if (pr.error) return <>{header()}<ErrorState error={pr.error} onRetry={() => void pr.refetch()} /></>;
  const p = pr.data;
  if (!p) return <>{header()}<EmptyState>{m.notFound}</EmptyState></>;
  const setTab = (v: string) => {
    const t = TABS.find((x) => x === v);
    if (t) void navigate({ search: (s) => ({ ...s, tab: t }), replace: true });
  };
  return (
    <>
      {header(p)}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <PrStateBadge pr={p} />
          <ChecksBadge checks={p.checks} />
          <ReviewBadge review={p.review} />
          {p.mergeable === false && p.state === "open" && <Pill t="bad">{m.prs.notMergeable}</Pill>}
          <span>{m.prs.by(p.author)}</span>
          <RelativeTime iso={p.updatedAt} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-xs break-all">{p.head} → {p.base}</span>
          <LocalBranchLink branchId={p.branchId} />
        </div>
        {p.state === "open" && <PrActions pr={p} />}
        <Tabs value={search.tab} onValueChange={setTab} className="gap-4">
          <TabsList className="h-11 w-full md:h-9 md:w-auto">
            <TabsTrigger value="conversation" className="px-2 md:px-3">{m.prs.tabs.conversation}</TabsTrigger>
            <TabsTrigger value="files" className="px-2 md:px-3">{m.prs.tabs.files} <span className="text-xs text-muted-foreground">{p.files.length}</span></TabsTrigger>
            <TabsTrigger value="diff" className="px-2 md:px-3">{m.prs.tabs.diff}</TabsTrigger>
            <TabsTrigger value="checks" className="px-2 md:px-3">{m.prs.tabs.checks}</TabsTrigger>
          </TabsList>
          <TabsContent value="conversation" className="flex flex-col gap-4">
            <Conversation pr={p} />
          </TabsContent>
          <TabsContent value="files">
            {p.files.length ? (
              <RowList>
                {p.files.map((f) => (
                  <li key={f.path}>
                    <Link to="/prs/$pr" params={{ pr: p.id }} search={{ tab: "diff", wrap: search.wrap }} hash={"file-" + f.path} className="flex min-h-11 items-center gap-2 px-3 py-2 hover:bg-muted/50">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">{f.status}</span>
                      <span className="min-w-0 flex-1 font-mono text-xs break-all">{f.path}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums"><span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span></span>
                    </Link>
                  </li>
                ))}
              </RowList>
            ) : <EmptyState>{m.prs.noFiles}</EmptyState>}
          </TabsContent>
          <TabsContent value="diff" className="flex flex-col gap-3">
            <SwitchRow label={m.prs.wrap}>
              <Switch checked={search.wrap} onCheckedChange={(wrap) => void navigate({ search: (s) => ({ ...s, wrap }), replace: true })} />
            </SwitchRow>
            <DiffViewer diff={p.diff} wrap={search.wrap} truncated={p.diffTruncated} />
          </TabsContent>
          <TabsContent value="checks">
            {p.checkRuns.length ? (
              <RowList>
                {p.checkRuns.map((c) => (
                  <li key={c.name} className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm">
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">{c.name}</a> : <span>{c.name}</span>}
                    <ChecksBadge checks={{ state: c.state, total: 0, failed: 0, pending: 0 }} />
                  </li>
                ))}
              </RowList>
            ) : <EmptyState>{m.prs.noChecks}</EmptyState>}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function LocalBranchLink({ branchId }: { branchId: string | null }): React.ReactNode {
  const branch = useQuery({ ...q.branch(branchId ?? ""), enabled: !!branchId });
  if (!branchId) return null;
  if (!branch.data) return branch.isPending ? null : <span className="text-xs text-muted-foreground">{m.prs.branchNotLocal}</span>;
  return <Link to="/branches/$id" params={{ id: branchId }} className="text-xs underline-offset-4 hover:underline">{m.prs.localBranch} →</Link>;
}

function PrActions({ pr }: { pr: PullRequestDetail }): React.ReactNode {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<"merge" | "close" | null>(null);
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const done = () => {
    setDialog(null);
    void client.invalidateQueries({ queryKey: ["pr", pr.id] });
    void client.invalidateQueries({ queryKey: ["prs"] });
    void client.invalidateQueries({ queryKey: ["inv"] });
  };
  const merge = useMutation({ mutationFn: () => mergePullRequest({ id: pr.id, method, deleteRemoteBranch: deleteBranch }), onSuccess: done });
  const close = useMutation({ mutationFn: () => closePullRequest({ id: pr.id }), onSuccess: done });
  const error = merge.error ?? close.error;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 md:h-9" disabled={pr.mergeable === false || merge.isPending} onClick={() => setDialog("merge")}>
          <GitMergeIcon />{m.prs.merge}
        </Button>
        <Button variant="destructive" className="h-11 md:h-9" disabled={close.isPending} onClick={() => setDialog("close")}>
          <XCircleIcon />{m.prs.close}
        </Button>
        <NewRunButton target={{ repo: pr.repo, branchId: pr.branchId ?? undefined, pullRequestId: pr.id, label: `${repoName(pr.repo)} #${pr.number}` }} />
      </div>
      {error && <ErrorState error={error} />}
      <ConfirmDialog
        open={dialog === "merge"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={m.prs.mergeConfirm(pr.number, m.prs.mergeMethod[method])}
        description={`${pr.head} → ${pr.base}`}
        confirm={m.prs.merge}
        onConfirm={() => merge.mutate()}
      >
        <div className="flex flex-col gap-3">
          <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={method}
            onValueChange={(v) => { if (v === "merge" || v === "squash" || v === "rebase") setMethod(v); }}>
            {(["merge", "squash", "rebase"] as const).map((x) => (
              <ToggleGroupItem key={x} value={x} className="h-11 flex-1 px-2 md:h-8">{m.prs.mergeMethod[x]}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <SwitchRow label={m.prs.deleteBranch}><Switch checked={deleteBranch} onCheckedChange={setDeleteBranch} /></SwitchRow>
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)} title={m.prs.closeConfirm(pr.number)} confirm={m.prs.close} destructive onConfirm={() => close.mutate()} />
    </div>
  );
}

function Conversation({ pr }: { pr: PullRequestDetail }): React.ReactNode {
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [confirm, setConfirm] = useState(false);
  const comment = useMutation({
    mutationFn: () => commentPullRequest({ id: pr.id, body }),
    onSuccess: () => {
      setBody("");
      setConfirm(false);
      void client.invalidateQueries({ queryKey: ["pr", pr.id] });
    },
  });
  const timeline = [
    ...pr.reviews.map((r) => ({ ...r, kind: "review" as const })),
    ...pr.comments.map((c) => ({ ...c, state: "", kind: "comment" as const })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <>
      <Card>
        {pr.body.trim() ? <div className="text-sm break-words whitespace-pre-wrap">{pr.body}</div> : <p className="text-sm text-muted-foreground">{m.prs.noBody}</p>}
      </Card>
      {timeline.length ? (
        <ul className="flex flex-col gap-2">
          {timeline.map((t, i) => (
            <li key={i}>
              <Card className="flex flex-col gap-1.5">
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t.author}</span>
                  {t.kind === "review" && t.state && <Pill t={/approv/i.test(t.state) ? "good" : /change/i.test(t.state) ? "bad" : "neutral"}>{t.state.toLowerCase().replace(/_/g, " ")}</Pill>}
                  <RelativeTime iso={t.at} />
                </span>
                {t.body && <div className="text-sm break-words whitespace-pre-wrap">{t.body}</div>}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{m.prs.noComments}</p>
      )}
      <FilterField label={m.prs.comment} labelFor="pr-comment">
        <Textarea id="pr-comment" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={m.prs.commentPlaceholder} />
      </FilterField>
      <Button variant="outline" className="h-11 self-start md:h-9" disabled={!body.trim() || comment.isPending} onClick={() => setConfirm(true)}>
        <MessageSquareIcon />{m.prs.comment}
      </Button>
      {comment.error && <ErrorState error={comment.error} />}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={m.prs.commentConfirm(pr.number)} description={<p className="line-clamp-4 whitespace-pre-wrap">{body}</p>} confirm={m.prs.comment} onConfirm={() => comment.mutate()} />
    </>
  );
}
