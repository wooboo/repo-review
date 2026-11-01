import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { FilterField } from "@/components/filters/field";
import { OptionSelect } from "@/components/filters/controls";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startAgentRun } from "@/lib/api/client";
import type { AgentTask, WorktreeMode } from "@/lib/api/types";
import { q } from "@/lib/queries";
import { m } from "@/messages";

export type RunTarget = { repo: string; branchId?: string; pullRequestId?: string; label: string };

const TASKS: Record<"repo" | "branch" | "pr", AgentTask[]> = {
  repo: ["cleanup-repo", "describe-repo", "custom"],
  branch: ["review-branch", "make-pr", "custom"],
  pr: ["review-pr", "custom"],
};

/** "New run" sheet: agent, model (from listAgents), task, note, worktree mode. */
export function NewRunSheet({ target, open, onOpenChange }: { target: RunTarget; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        {open && <Form target={target} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

export function NewRunButton({ target, variant = "outline", className }: { target: RunTarget; variant?: "outline" | "default"; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className ?? "h-11 md:h-9"} onClick={() => setOpen(true)}>
        <BotIcon />
        {m.repos.askAgent}
      </Button>
      <NewRunSheet target={target} open={open} onOpenChange={setOpen} />
    </>
  );
}

function Form({ target, onDone }: { target: RunTarget; onDone: () => void }) {
  const agents = useQuery(q.agents());
  const client = useQueryClient();
  const navigate = useNavigate();
  const kind = target.pullRequestId ? "pr" : target.branchId ? "branch" : "repo";
  const tasks = TASKS[kind];
  const [agentId, setAgentId] = useState("");
  const [model, setModel] = useState("");
  const [task, setTask] = useState<AgentTask>(tasks[0]);
  const [note, setNote] = useState("");
  const [worktree, setWorktree] = useState<WorktreeMode>(kind === "repo" ? "none" : "new");
  const agent = agents.data?.find((a) => a.id === agentId) ?? agents.data?.[0];
  const effectiveModel = model && agent?.models.includes(model) ? model : (agent?.defaultModel ?? "");
  const start = useMutation({
    mutationFn: () =>
      startAgentRun({
        agentId: agent!.id,
        model: effectiveModel || undefined,
        task,
        repo: target.repo,
        branchId: target.branchId,
        pullRequestId: target.pullRequestId,
        note: note.trim() || undefined,
        worktree,
      }),
    onSuccess: ({ id }) => {
      void client.invalidateQueries({ queryKey: ["runs"] });
      onDone();
      void navigate({ to: "/agents/$run", params: { run: id } });
    },
  });
  const seg = "h-auto min-h-11 flex-1 px-2 py-1 leading-tight whitespace-normal md:min-h-8";
  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>{m.agents.newRun}</SheetTitle>
        <SheetDescription className="break-all">{target.label}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {agents.error ? (
          <ErrorState error={agents.error} onRetry={() => void agents.refetch()} />
        ) : agents.data && !agents.data.length ? (
          <EmptyState>{m.agents.noAgents}</EmptyState>
        ) : (
          <>
            <FilterField label={m.agents.agent} labelFor="run-agent">
              <OptionSelect id="run-agent" value={agent?.id ?? ""} onChange={(v) => { setAgentId(v); setModel(""); }}
                options={(agents.data ?? []).map((a) => ({ value: a.id, label: `${a.label} (${m.settings.agentKinds[a.kind]})` }))} />
            </FilterField>
            <FilterField label={m.agents.model} labelFor="run-model">
              <OptionSelect id="run-model" value={effectiveModel} onChange={setModel}
                options={(agent?.models ?? []).map((x) => ({ value: x, label: x }))} />
            </FilterField>
            <FilterField label={m.agents.task} labelFor="run-task">
              <OptionSelect id="run-task" value={task} onChange={(v) => v && setTask(v)} options={tasks.map((t) => ({ value: t, label: m.agents.tasks[t] }))} />
            </FilterField>
            <FilterField label={m.agents.note} labelFor="run-note">
              <Textarea id="run-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder={m.agents.notePlaceholder} />
            </FilterField>
            <FilterField label={m.agents.worktree}>
              <ToggleGroup type="single" variant="outline" spacing={0} className="w-full" value={worktree}
                onValueChange={(v) => { if (v === "new" || v === "existing" || v === "none") setWorktree(v); }}>
                {(["new", "existing", "none"] as const).map((w) => (
                  <ToggleGroupItem key={w} value={w} className={seg}>{m.agents.worktreeMode[w]}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FilterField>
            {start.error && <ErrorState error={start.error} />}
          </>
        )}
      </div>
      <SheetFooter className="border-t">
        <Button className="h-11 w-full md:h-9" disabled={!agent || start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? <Loader2Icon className="animate-spin" /> : <BotIcon />}
          {m.agents.start}
        </Button>
      </SheetFooter>
    </>
  );
}
