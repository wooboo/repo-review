import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangleIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { CopyButton, KV, Mono, Pill, StatusBadge } from "@/components/domain";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { applyActions, asDeletionPlan, planRepositoryDeletion } from "@/lib/api/client";
import type { CloneDeletionSummary, PlannedAction, RepositoryDeletionPlan } from "@/lib/api/types";
import { actionOf, archivePathOf, cloneBlocked, confirmMatches, deletionScope, isDeletionConfirmationError } from "@/lib/deletion";
import { formatBytes } from "@/lib/format";
import { asActions, q, useJob } from "@/lib/queries";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export type DeletionClone = { id: string; host: string; path: string };
type Request = { repositoryId: string; name: string; clones: DeletionClone[]; preselected: string[] | null };

/**
 * "Delete from disk": choose clones → read-only plan on each host → review what is archived and
 * what is lost → type the repository name → archive and delete → per-clone results.
 * One per page: `start(...)` opens it, render `sheet` unconditionally (it outlives the repository).
 */
export function useRepositoryDeletion() {
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [onClose, setOnClose] = useState<(() => void) | null>(null);
  const close = () => {
    if (busy) return;
    onClose?.();
    setOnClose(null);
    setRequest(null);
  };
  return {
    start: (repositoryId: string, name: string, clones: DeletionClone[], preselected: string[] | null = null) =>
      setRequest({ repositoryId, name, clones, preselected }),
    sheet: (
      <Sheet open={request !== null} onOpenChange={(o) => !o && close()}>
        <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          {request && (
            <DeletionFlow
              key={request.repositoryId + (request.preselected ?? []).join("\n")}
              request={request}
              onBusy={setBusy}
              onFinished={(f) => setOnClose(() => f)}
              onDone={() => {
                onClose?.();
                setOnClose(null);
                setRequest(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    ),
  };
}

function DeletionFlow({ request, onBusy, onFinished, onDone }: { request: Request; onBusy: (b: boolean) => void; onFinished: (f: () => void) => void; onDone: () => void }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(request.preselected ?? request.clones.map((c) => c.id)));
  const [step, setStep] = useState<"select" | "review">(request.preselected ? "review" : "select");
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);

  const plan = useMutation({ mutationFn: (cloneIds: string[]) => planRepositoryDeletion({ repositoryId: request.repositoryId, cloneIds }) });
  const planJob = useJob(plan.data?.id ?? null, asDeletionPlan);
  const apply = useMutation({
    mutationFn: (input: { ids: string[]; confirm: string }) => applyActions(input.ids, input.confirm),
    onError: (e) => {
      if (isDeletionConfirmationError(e)) {
        setMismatch(true);
        setTyped("");
      }
    },
  });
  const applyJob = useJob(apply.data?.id ?? null, asActions);

  // A single clone from its row skips the selection step and checks right away.
  useEffect(() => {
    if (request.preselected) plan.mutate([...selected]);
  }, []);

  const reviewed = planJob.data?.status === "done" ? planJob.data.result : null;
  const results = applyJob.data?.status === "done" ? (applyJob.data.result ?? []) : null;
  const planError = plan.error ?? (planJob.data?.status === "failed" ? planJob.data.error : null) ?? planJob.error;
  const applyError = (apply.error && !isDeletionConfirmationError(apply.error) ? apply.error : null) ?? (applyJob.data?.status === "failed" ? applyJob.data.error : null) ?? applyJob.error;
  const applying = apply.isPending || (apply.isSuccess && !results && !applyError);
  const scope = reviewed ? deletionScope(reviewed) : null;
  const name = reviewed?.summary.name ?? request.name;
  const purged = !!(results && reviewed && reviewed.summary.remainingClones === 0 && results.length === reviewed.summary.clones.length && results.every((a) => a.status === "done"));
  const deletedCount = results?.filter((a) => a.status === "done").length ?? 0;

  useEffect(() => onBusy(applying), [applying, onBusy]);
  useEffect(() => {
    if (!results) return;
    // The page refreshes behind the sheet; a purge leaves it empty, so closing goes to the list.
    void client.invalidateQueries({ queryKey: ["inv"] });
    void client.invalidateQueries({ queryKey: ["prs"] });
    void client.invalidateQueries({ queryKey: ["actions"] });
    onFinished(() => {
      if (purged) {
        void navigate({ to: "/repos" });
        toast(m.deletion.toastPurged(name), { action: { label: m.deletion.showArchives, onClick: () => void navigate({ to: "/repos", search: { view: "deleted" } }) } });
      } else if (deletedCount) toast(m.deletion.toastPartial(deletedCount));
    });
  }, [results !== null]);

  const progress = useQuery({ ...q.actions({ page: 1, pageSize: 50 }), enabled: applying, refetchInterval: applying ? 1500 : false });
  const live = useMemo(() => new Map((progress.data?.items ?? []).map((a) => [a.id, a])), [progress.data]);

  const startPlan = () => {
    setStep("review");
    setMismatch(false);
    setTyped("");
    plan.mutate([...selected]);
  };

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{results ? m.deletion.resultTitle : m.deletion.title(name)}</SheetTitle>
        <SheetDescription>{m.actions.hint["delete-clone"]}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {step === "select" ? (
          <ChooseClones clones={request.clones} selected={selected} onChange={setSelected} />
        ) : planError ? (
          <ErrorState error={planError} onRetry={() => plan.mutate([...selected])} />
        ) : !reviewed ? (
          <Busy text={m.deletion.planning} />
        ) : results ? (
          <Results results={results} plan={reviewed} />
        ) : applying ? (
          <Applying plan={reviewed} ids={scope?.ids ?? []} live={live} />
        ) : (
          <Review plan={reviewed} />
        )}
        {applyError && <ErrorState error={applyError} />}
      </div>
      <SheetFooter className="border-t">
        {step === "select" ? (
          <Button className="h-11 w-full md:h-9" disabled={!selected.size} onClick={startPlan}>
            {m.deletion.check(selected.size)}
          </Button>
        ) : results ? (
          <Button className="h-11 w-full md:h-9" onClick={onDone}>{m.deletion.done}</Button>
        ) : reviewed && scope && !applying ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!confirmMatches(typed, name) || !scope.ids.length) return;
              setMismatch(false);
              apply.mutate({ ids: scope.ids, confirm: typed.trim() });
            }}
          >
            {scope.ids.length ? (
              <>
                <label htmlFor="delete-confirm" className="text-sm">
                  {m.deletion.confirmBefore} <span className="font-mono font-semibold break-all">{name}</span> {m.deletion.confirmAfter}
                </label>
                <Input
                  id="delete-confirm"
                  className="h-11 font-mono md:h-9"
                  value={typed}
                  onChange={(e) => { setTyped(e.target.value); setMismatch(false); }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={mismatch || undefined}
                  aria-describedby="delete-confirm-hint"
                />
                <p id="delete-confirm-hint" className={cn("text-xs", mismatch ? "text-destructive" : "text-muted-foreground")}>
                  {mismatch ? m.deletion.confirmMismatch : m.deletion.confirmHint}
                </p>
                <Button type="submit" variant="destructive" className="h-11 w-full md:h-9" disabled={!confirmMatches(typed, name)}>
                  {m.deletion.delete(scope.ids.length)}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{m.deletion.nothingToDelete}</p>
            )}
            {!request.preselected || request.clones.length > 1 ? (
              <Button type="button" variant="ghost" className="h-11 w-full md:h-9" onClick={() => { plan.reset(); setStep("select"); }}>
                {m.deletion.back}
              </Button>
            ) : null}
          </form>
        ) : null}
      </SheetFooter>
    </>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
      <Loader2Icon className="size-4 animate-spin" />
      {text}
    </p>
  );
}

function ChooseClones({ clones, selected, onChange }: { clones: DeletionClone[]; selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const all = clones.every((c) => selected.has(c.id));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{m.deletion.chooseClones}</legend>
      <ul className="flex flex-col divide-y rounded-xl border">
        {clones.length > 1 && (
          <li>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 p-3 text-sm font-medium">
              <Checkbox className="size-5" checked={all ? true : selected.size ? "indeterminate" : false}
                onCheckedChange={(on) => onChange(new Set(on === true ? clones.map((c) => c.id) : []))} />
              {m.deletion.selectAll}
            </label>
          </li>
        )}
        {clones.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-14 cursor-pointer items-start gap-3 p-3">
              <Checkbox className="mt-0.5 size-5" checked={selected.has(c.id)} onCheckedChange={(on) => toggle(c.id, on === true)} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{c.host}</span>
                <Mono className="text-muted-foreground">{c.path}</Mono>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{m.deletion.chooseHint}</p>
    </fieldset>
  );
}

/** The review step: scope of the deletion, then every clone's summary. Exported for tests. */
export function Review({ plan }: { plan: RepositoryDeletionPlan }) {
  const scope = deletionScope(plan);
  return (
    <>
      <ScopeNote plan={plan} />
      {plan.summary.clones.map((c) => (
        <CloneSummary key={c.actionId} clone={c} action={actionOf(plan.actions, c)} />
      ))}
      {scope.blocked > 0 && scope.ids.length === 0 && <p className="text-sm text-destructive">{m.deletion.nothingToDelete}</p>}
    </>
  );
}

function ScopeNote({ plan }: { plan: RepositoryDeletionPlan }) {
  const scope = deletionScope(plan);
  const s = plan.summary;
  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border p-3 text-sm", scope.purges ? "border-destructive/50 bg-destructive/5" : "bg-muted/40")}>
      <p className="flex gap-2">
        <AlertTriangleIcon className={cn("mt-0.5 size-4 shrink-0", scope.purges ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
        <span>
          {scope.purges ? m.deletion.scopePurge : scope.blocked && s.purgesRepository ? m.deletion.scopeBlocked(scope.blocked) : m.deletion.scopePartial(s.remainingClones + scope.blocked)}
        </span>
      </p>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">{m.deletion.archiveDir}</span>
        <Mono>{s.archiveDir}</Mono>
        <span className="text-xs text-muted-foreground">{m.deletion.archiveHint}</span>
      </div>
    </div>
  );
}

function CloneSummary({ clone: c, action }: { clone: CloneDeletionSummary; action: PlannedAction | undefined }) {
  const blocked = cloneBlocked(c, action);
  const blockers = c.blockers.length ? c.blockers : blocked && action?.reason ? [action.reason] : [];
  return (
    <section className={cn("flex flex-col gap-3 rounded-xl border p-3", blocked && "border-destructive/50")} aria-label={`${c.host}:${c.path}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{c.host}</span>
          <Mono className="text-muted-foreground">{c.path}</Mono>
        </span>
        {blocked ? <Pill t="bad">{m.actions.status.blocked}</Pill> : <span className="shrink-0 text-sm tabular-nums">{formatBytes(c.sizeBytes)}</span>}
      </div>
      {blockers.length > 0 && (
        <Callout tone="bad" title={m.deletion.blockers}>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">{blockers.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>
          <p className="text-xs">{m.deletion.blockedClone}</p>
        </Callout>
      )}
      {c.unpushedBranches.length > 0 && (
        <Callout tone="warn" title={`${m.deletion.unpushed} · ${c.unpushedBranches.length}`}>
          <ul className="flex flex-col gap-0.5">
            {c.unpushedBranches.map((b) => (
              <li key={b.name} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs break-all">{b.name}</span>
                <span className="text-xs">{m.deletion.ahead(b.ahead)}{b.integrated ? ` · ${m.deletion.integrated}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs">{m.deletion.unpushedHint}</p>
        </Callout>
      )}
      {c.activeThreads.length > 0 && (
        <Callout tone="bad" title={`${m.deletion.activeThreads} · ${c.activeThreads.length}`}>
          <ul className="flex flex-col gap-0.5">{c.activeThreads.map((t) => <li key={t.id} className="break-words">{t.title || t.id}</li>)}</ul>
        </Callout>
      )}
      <KV rows={[
        [m.deletion.size, formatBytes(c.sizeBytes)],
        [m.deletion.branches, c.branches.toLocaleString("en")],
        [m.deletion.dirtyFiles, <span key="d" className={cn(c.dirtyFiles > 0 && "font-medium text-warning")}>{c.dirtyFiles.toLocaleString("en")}</span>],
        [m.deletion.stashes, <span key="s" className={cn(c.stashes > 0 && "font-medium text-warning")}>{c.stashes.toLocaleString("en")}</span>],
        [m.deletion.ignoredKept, m.deletion.files(c.ignoredKept.files, formatBytes(c.ignoredKept.bytes))],
        [m.deletion.ignoredSkipped, <span key="i" className={cn(c.ignoredSkipped.files > 0 && "font-medium text-destructive")}>{m.deletion.files(c.ignoredSkipped.files, formatBytes(c.ignoredSkipped.bytes))}</span>],
      ]} />
      {c.ignoredSkipped.files > 0 && <p className="-mt-1 text-xs text-muted-foreground">{m.deletion.ignoredSkippedHint}</p>}
      {c.linkedWorktrees.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{m.deletion.linkedWorktrees} · {c.linkedWorktrees.length}</span>
          <ul className="flex flex-col gap-1">
            {c.linkedWorktrees.map((w) => (
              <li key={w.path} className="flex flex-col gap-0.5 rounded-lg bg-muted/50 p-2">
                <Mono>{w.path}</Mono>
                <span className="flex flex-wrap items-center gap-1">
                  <span className="font-mono text-xs">{w.branch ?? m.deletion.detached}</span>
                  {w.dirty && <Pill t="warn" className="h-5">{m.deletion.dirty}</Pill>}
                  {w.missing && <Pill t="bad" className="h-5">{m.deletion.missing}</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Callout({ tone, title, children }: { tone: "warn" | "bad"; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg border p-2.5 text-sm", tone === "bad" ? "border-destructive/40 bg-destructive/5" : "border-warning/50 bg-warning/10")}>
      <span className={cn("font-medium", tone === "bad" ? "text-destructive" : "text-warning")}>{title}</span>
      {children}
    </div>
  );
}

function Applying({ plan, ids, live }: { plan: RepositoryDeletionPlan; ids: string[]; live: Map<string, PlannedAction> }) {
  return (
    <>
      <Busy text={m.deletion.applying} />
      <ul className="flex flex-col divide-y rounded-xl border">
        {plan.summary.clones.filter((c) => ids.includes(c.actionId)).map((c) => {
          const status = live.get(c.actionId)?.status;
          return (
            <li key={c.actionId} className="flex items-start justify-between gap-2 p-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{c.host}</span>
                <Mono className="text-muted-foreground">{c.path}</Mono>
              </span>
              {status && status !== "planned" ? (
                <StatusBadge status={status} label={status === "running" ? m.deletion.statusRunning : m.actions.status[status]} />
              ) : (
                <Pill>{m.deletion.statusWaiting}</Pill>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Results({ results, plan }: { results: readonly PlannedAction[]; plan: RepositoryDeletionPlan }) {
  const tombstones = useQuery(q.deletedRepos());
  return (
    <ul className="flex flex-col gap-2">
      {results.map((a) => {
        const archive = a.status === "done" ? archivePathOf(a, tombstones.data) : null;
        const clone = plan.summary.clones.find((c) => c.actionId === a.id);
        return (
          <li key={a.id} className="flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{clone?.host ?? a.target.host}</span>
                <Mono className="text-muted-foreground">{clone?.path ?? a.target.repo}</Mono>
              </span>
              <StatusBadge status={a.status} label={m.actions.status[a.status]} />
            </div>
            {a.reason && <p className="text-sm break-words text-muted-foreground">{a.reason}</p>}
            {archive && (
              <div className="flex flex-col gap-1 rounded-lg bg-muted p-2">
                <span className="text-xs text-muted-foreground">{m.deletion.archivePath}</span>
                <div className="flex items-center gap-2">
                  <Mono className="min-w-0 flex-1">{archive}</Mono>
                  <CopyButton text={archive} />
                </div>
              </div>
            )}
            {a.restore && (
              <Collapsible>
                <CollapsibleTrigger className="group flex min-h-11 items-center gap-2 text-sm font-medium md:min-h-8">
                  {m.deletion.restore}
                  <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-2 pt-1">
                  <Mono className="block rounded-lg bg-muted p-2 whitespace-pre-wrap">{a.restore}</Mono>
                  <CopyButton text={a.restore} className="self-start" />
                </CollapsibleContent>
              </Collapsible>
            )}
          </li>
        );
      })}
    </ul>
  );
}
