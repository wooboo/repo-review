import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CopyButton, Mono, StatusBadge } from "@/components/domain";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { applyActions, planActions } from "@/lib/api/client";
import type { PlanInput, PlannedAction } from "@/lib/api/types";
import { repoName } from "@/lib/format";
import { asActions, useJob } from "@/lib/queries";
import { m } from "@/messages";

/**
 * Destructive flow: plan (dry run on every host) → review what will run and what is skipped or
 * blocked, with reasons → confirm → live results with restore commands.
 */
export function ActionFlowSheet({ request, onClose }: { request: PlanInput | null; onClose: () => void }) {
  return (
    <Sheet open={request !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {request && <Flow key={JSON.stringify(request)} request={request} />}
      </SheetContent>
    </Sheet>
  );
}

function Flow({ request }: { request: PlanInput }) {
  const client = useQueryClient();
  const plan = useMutation({ mutationFn: () => planActions(request) });
  const apply = useMutation({ mutationFn: (ids: string[]) => applyActions(ids) });
  useEffect(() => {
    plan.mutate();
  }, []);
  const planJob = useJob(plan.data?.id ?? null, asActions);
  const applyJob = useJob(apply.data?.id ?? null, asActions);
  const planned = planJob.data?.status === "done" ? (planJob.data.result ?? []) : null;
  const results = applyJob.data?.status === "done" ? (applyJob.data.result ?? []) : null;
  const runnable = useMemo(() => planned?.filter((a) => a.status === "planned") ?? [], [planned]);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const selected = runnable.filter((a) => !unchecked.has(a.id));

  useEffect(() => {
    if (results) void client.invalidateQueries({ queryKey: ["inv"] });
  }, [results, client]);

  const planError = plan.error ?? (planJob.data?.status === "failed" ? planJob.data.error : null) ?? planJob.error;
  const applyError = apply.error ?? (applyJob.data?.status === "failed" ? applyJob.data.error : null) ?? applyJob.error;
  const applying = apply.isPending || (apply.isSuccess && !results && !applyError);
  const kind = request.kind;

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{results ? m.actions.resultTitle : m.actions.planTitle}</SheetTitle>
        <SheetDescription>{kind === "archive-and-delete" ? m.actions.archiveHint : m.actions.deleteHint}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {planError ? (
          <ErrorState error={planError} onRetry={() => plan.mutate()} />
        ) : results ? (
          <ActionList actions={results} showRestore />
        ) : applying ? (
          <Busy text={m.actions.applying} />
        ) : !planned ? (
          <Busy text={m.actions.planning} />
        ) : planned.length === 0 ? (
          <EmptyState>{m.actions.planEmpty}</EmptyState>
        ) : (
          <>
            {runnable.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{m.actions.willRun(selected.length)}</h3>
                <ul className="flex flex-col divide-y rounded-xl border">
                  {runnable.map((a) => (
                    <li key={a.id}>
                      <label className="flex min-h-14 cursor-pointer items-start gap-3 p-3">
                        <Checkbox
                          className="mt-0.5 size-5"
                          checked={!unchecked.has(a.id)}
                          onCheckedChange={(on) =>
                            setUnchecked((prev) => {
                              const next = new Set(prev);
                              if (on) next.delete(a.id);
                              else next.add(a.id);
                              return next;
                            })
                          }
                        />
                        <ActionTargetText action={a} />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {planned.length > runnable.length && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{m.actions.notRun(planned.length - runnable.length)}</h3>
                <ActionList actions={planned.filter((a) => a.status !== "planned")} />
              </section>
            )}
          </>
        )}
        {applyError && <ErrorState error={applyError} />}
      </div>
      {planned && !results && !applying && runnable.length > 0 && (
        <SheetFooter className="border-t">
          <Button variant="destructive" className="h-11 w-full md:h-9" disabled={!selected.length} onClick={() => apply.mutate(selected.map((a) => a.id))}>
            {m.actions.confirm(kind, selected.length)}
          </Button>
        </SheetFooter>
      )}
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

function ActionTargetText({ action }: { action: PlannedAction }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="font-medium break-all">{action.target.branch ?? action.target.worktree ?? m.actions.kind[action.kind]}</span>
      <span className="text-xs text-muted-foreground break-all">
        {action.repoKey ? repoName(action.repoKey) + " · " : ""}
        {action.target.host}:{action.target.repo}
      </span>
    </span>
  );
}

export function ActionList({ actions, showRestore }: { actions: readonly PlannedAction[]; showRestore?: boolean }) {
  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {actions.map((a) => (
        <li key={a.id} className="flex flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <ActionTargetText action={a} />
            <StatusBadge status={a.status} label={m.actions.status[a.status]} />
          </div>
          {a.reason && <p className="text-sm text-muted-foreground">{a.reason}</p>}
          {showRestore && a.restore && (
            <div className="flex items-center gap-2 rounded-lg bg-muted p-2" title={m.actions.restoreHelp}>
              <Mono className="min-w-0 flex-1">{a.restore}</Mono>
              <CopyButton text={a.restore} label={m.actions.restore} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
