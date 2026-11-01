import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLinkIcon, SquareIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm";
import { KV, Mono, Pill, RelativeTime, StatusBadge } from "@/components/domain";
import { Card, PageHeader, Section } from "@/components/page-header";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { mergeChunks } from "@/lib/api/adapters";
import { cancelAgentRun, getAgentRun } from "@/lib/api/client";
import type { AgentEvent } from "@/lib/api/types";
import { formatCost, formatDuration, repoName } from "@/lib/format";
import { POLL_MS, useLiveMode } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export const Route = createFileRoute("/agents/$run")({
  head: () => title(m.agents.runs, m.agents.title),
  component: RunPage,
});

const active = (s: string | undefined) => s === "running" || s === "queued";

/** Live run: events are fetched incrementally with a cursor and appended. */
function RunPage() {
  const { run: id } = Route.useParams();
  const client = useQueryClient();
  const live = useLiveMode();
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const cursor = useRef(0);
  const run = useQuery({
    queryKey: ["run", id],
    queryFn: async () => {
      const detail = await getAgentRun(id, cursor.current);
      if (detail) {
        cursor.current = detail.cursor;
        if (detail.events.length) setEvents((prev) => [...prev, ...detail.events]);
      }
      return detail?.run ?? null;
    },
    refetchInterval: (query) => (active(query.state.data?.status) && live !== "sse" ? POLL_MS : false),
    staleTime: 0,
    gcTime: 0,
  });
  const cancel = useMutation({ mutationFn: () => cancelAgentRun(id), onSuccess: () => void client.invalidateQueries({ queryKey: ["run", id] }) });
  const [confirm, setConfirm] = useState(false);
  const merged = useMemo(() => mergeChunks(events), [events]);
  const end = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      follow.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (follow.current && active(run.data?.status)) end.current?.scrollIntoView({ block: "end" });
  }, [merged.length, run.data?.status]);

  const header = <PageHeader back="/agents" title={m.agents.runs} subtitle={<Mono>{id}</Mono>} />;
  if (run.isPending) return <>{header}<PageSkeleton /></>;
  if (run.error) return <>{header}<ErrorState error={run.error} onRetry={() => void run.refetch()} /></>;
  const r = run.data;
  if (!r) return <>{header}<EmptyState>{m.agents.notFound}</EmptyState></>;
  const branch = r.branchId?.split("#").slice(1).join("#");
  const finished = r.finishedAt ? formatDuration(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) : "";

  return (
    <>
      <PageHeader
        back="/agents"
        title={`${m.agents.tasks[r.task]} · ${repoName(r.repo)}`}
        subtitle={<>{r.agentId} · {r.model} · <RelativeTime iso={r.startedAt} /></>}
        actions={<StatusBadge status={r.status} label={m.agents.status[r.status]} />}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <KV rows={[
            [m.agents.target, <span key="t" className="flex flex-wrap gap-x-2">
              <Link to="/repos/$repo" params={{ repo: r.repo }} className="underline-offset-4 hover:underline">{repoName(r.repo)}</Link>
              {r.branchId && branch && <Link to="/branches/$id" params={{ id: r.branchId }} className="font-mono text-xs underline-offset-4 hover:underline">{branch}</Link>}
            </span>],
            [m.agents.cwd, <Mono key="c">{r.cwd}</Mono>],
            ...(finished ? [[m.agents.duration, finished] as [string, string]] : []),
            ...(r.costUsd !== null ? [[m.agents.cost, formatCost(r.costUsd)] as [string, string]] : []),
          ]} />
          <div className="mt-3 flex flex-wrap gap-2">
            {active(r.status) && (
              <Button variant="destructive" className="h-11 md:h-9" disabled={cancel.isPending} onClick={() => setConfirm(true)}>
                <SquareIcon />{m.agents.cancelRun}
              </Button>
            )}
            {r.pullRequestUrl && (
              <Button variant="outline" asChild className="h-11 md:h-9">
                <a href={r.pullRequestUrl} target="_blank" rel="noreferrer"><ExternalLinkIcon />{m.agents.openPr}</a>
              </Button>
            )}
          </div>
          {cancel.error && <ErrorState className="mt-3" error={cancel.error} />}
        </Card>

        {r.summary && !active(r.status) && (
          <Section title={m.agents.summary} id="summary">
            <Card><div className="text-sm break-words whitespace-pre-wrap">{r.summary}</div></Card>
          </Section>
        )}

        <Section title={m.agents.events} id="events" actions={active(r.status) && <Pill t="busy"><span className="size-1.5 animate-pulse rounded-full bg-current" />{m.agents.live}</Pill>}>
          {merged.length ? (
            <ol className="flex flex-col gap-1.5" aria-live="polite">
              {merged.map((e) => <EventRow key={e.seq} e={e} />)}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{m.agents.noEvents}</p>
          )}
          <div ref={end} />
        </Section>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={m.agents.cancelConfirm} confirm={m.agents.cancelRun} destructive onConfirm={() => cancel.mutate()} />
    </>
  );
}

function EventRow({ e }: { e: AgentEvent }) {
  const style = {
    message: "bg-card",
    thought: "bg-muted/50 italic text-muted-foreground",
    tool: "bg-card font-mono text-xs",
    permission: "border-warning/50 bg-warning/10",
    status: "font-mono text-xs text-muted-foreground",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
  }[e.kind];
  return (
    <li className={cn("flex flex-col gap-1 rounded-lg border p-2.5 text-sm", style)}>
      <span className="flex items-center justify-between gap-2 font-sans text-[11px] text-muted-foreground not-italic">
        <span className="font-medium uppercase">{m.agents.eventKind[e.kind]}</span>
        <RelativeTime iso={e.at} />
      </span>
      <span className="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</span>
    </li>
  );
}
