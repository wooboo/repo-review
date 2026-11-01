import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, syncPullRequests } from "@/lib/api/client";
import { useJob } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

/** "Sync PRs" job (all repositories, or one): spinner while it runs, then the PR and inventory views refresh. */
export function SyncPrsButton({ repo, className }: { repo?: string; className?: string }) {
  const client = useQueryClient();
  const sync = useMutation({ mutationFn: () => syncPullRequests({ repo }) });
  const job = useJob(sync.data?.id ?? null, () => null);
  const status = job.data?.status;
  const running = sync.isPending || (sync.isSuccess && status !== "done" && status !== "failed");
  useEffect(() => {
    if (status !== "done" && status !== "failed") return;
    void client.invalidateQueries({ queryKey: ["prs"] });
    void client.invalidateQueries({ queryKey: ["pr"] });
    void client.invalidateQueries({ queryKey: ["inv"] });
  }, [status, client]);
  const error = sync.error ?? (status === "failed" || status === "paused" ? job.data?.error : null);
  return (
    <span className={cn("flex flex-col items-end gap-1", className)}>
      <Button variant="outline" className="h-11 md:h-9" disabled={running} onClick={() => sync.mutate()}>
        {status === "done" && !running ? <CheckIcon /> : <RefreshCwIcon className={cn(running && "animate-spin")} />}
        {running ? m.prs.syncing : status === "done" ? m.prs.synced : m.prs.sync}
      </Button>
      {error && <span role="alert" className="max-w-64 text-right text-xs break-words text-destructive">{errorMessage(error)}</span>}
    </span>
  );
}
