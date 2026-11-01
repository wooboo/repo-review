import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Pill, RelativeTime, StatusBadge } from "@/components/domain";
import { SwitchRow } from "@/components/filters/field";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startScan } from "@/lib/api/client";
import type { Scan } from "@/lib/api/types";
import { formatDuration } from "@/lib/format";
import { POLL_MS, q, useLiveMode } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

const isActive = (s: Scan) => s.status === "queued" || s.status === "running";

/** Host selection (none = all enabled), fetch toggle and the start button. */
export function ScanControl({ className }: { className?: string }) {
  const client = useQueryClient();
  const settings = useQuery(q.settings());
  const hosts = settings.data?.hosts.filter((h) => h.enabled) ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [fetch, setFetch] = useState(true);
  const start = useMutation({
    mutationFn: () => startScan({ hosts: picked, fetch }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["scans"] });
      void client.invalidateQueries({ queryKey: ["inv", "dashboard"] });
    },
  });
  if (settings.data && !hosts.length) return <p className="text-sm text-muted-foreground">{m.scan.noEnabledHosts}</p>;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {hosts.length > 1 && (
        <ToggleGroup type="multiple" variant="outline" className="flex-wrap justify-start" value={picked} onValueChange={setPicked} aria-label={m.scan.hosts}>
          {hosts.map((h) => (
            <ToggleGroupItem key={h.id} value={h.id} className="h-11 px-3 md:h-8">
              {h.id}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-44 flex-1">
          <SwitchRow label={m.scan.fetch}>
            <Switch checked={fetch} onCheckedChange={setFetch} />
          </SwitchRow>
        </div>
        <Button className="h-11 md:h-9" disabled={start.isPending} onClick={() => start.mutate()}>
          {start.isPending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          {start.isPending ? m.scan.starting : picked.length && picked.length < hosts.length ? `${m.scan.now}: ${picked.join(", ")}` : m.scan.now}
        </Button>
      </div>
      {start.error && <ErrorState error={start.error} />}
    </div>
  );
}

/** Scan history with live progress for running scans; refreshes the inventory when one finishes. */
export function useScans() {
  const client = useQueryClient();
  const live = useLiveMode();
  const scans = useQuery({ ...q.scans(), refetchInterval: (query) => (live !== "sse" && query.state.data?.some(isActive) ? POLL_MS : false) });
  const running = scans.data?.filter(isActive).map((s) => s.id).join(",") ?? "";
  const previous = useRef(running);
  useEffect(() => {
    if (previous.current && previous.current !== running) void client.invalidateQueries({ queryKey: ["inv"] });
    previous.current = running;
  }, [running, client]);
  return scans;
}

function hostResults(scan: Scan) {
  const done = scan.events.filter((e) => e.type === "host-complete") as { host: string; repositories: number; errors: string[] }[];
  const progress = scan.events.filter((e) => e.type === "progress") as { host: string; path: string }[];
  const forge = scan.events.filter((e) => e.type === "forge-unavailable") as { repo: string }[];
  return { done, progress, forge };
}

export function ScanRow({ scan, defaultOpen }: { scan: Scan; defaultOpen?: boolean }) {
  const { done, progress, forge } = hostResults(scan);
  const active = isActive(scan);
  const duration = scan.finished ? formatDuration(Date.parse(scan.finished) - Date.parse(scan.started)) : "";
  const last = progress.at(-1);
  const errorCount = scan.errors.length + done.reduce((s, h) => s + h.errors.length, 0);
  const hasDetails = done.length > 0 || errorCount > 0 || forge.length > 0;
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger asChild disabled={!hasDetails}>
        <button type="button" className="group flex min-h-14 w-full items-center gap-3 p-3 text-left">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusBadge status={scan.status} label={m.scan.status[scan.status]} />
              <span className="font-medium">{(scan.hosts ?? []).join(", ") || m.scan.allHosts}</span>
              <span className="text-muted-foreground">
                {scan.fetch === false ? m.scan.noFetch : m.scan.withFetch}
              </span>
            </span>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <RelativeTime iso={scan.started} />
              {scan.trigger && <span>{m.scan.trigger(scan.trigger)}</span>}
              {duration && <span>{m.scan.took(duration)}</span>}
              {active && <span>{m.scan.progress(progress.length)}</span>}
              {errorCount > 0 && <span className="text-destructive">{m.scan.errors(errorCount)}</span>}
            </span>
            {active && last && <span className="truncate font-mono text-xs text-muted-foreground" title={last.path}>{last.host}: {last.path}</span>}
          </span>
          {hasDetails && <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />}
        </button>
      </CollapsibleTrigger>
      {hasDetails && <CollapsibleContent className="flex flex-col gap-2 border-t p-3 text-sm">
        {done.map((h) => (
          <div key={h.host} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{h.host}</span>
              <span className="text-muted-foreground">{m.scan.repos(h.repositories)}</span>
              {h.errors.length > 0 && <Pill t="bad">{m.scan.errors(h.errors.length)}</Pill>}
            </span>
            {h.errors.map((e, i) => (
              <p key={i} className="font-mono text-xs break-all text-destructive">{e}</p>
            ))}
          </div>
        ))}
        {scan.errors.map((e, i) => (
          <p key={i} className="font-mono text-xs break-all text-destructive">{e}</p>
        ))}
        {forge.map((f) => (
          <p key={f.repo} className="text-xs text-muted-foreground">{m.scan.forgeUnavailable(f.repo)}</p>
        ))}
      </CollapsibleContent>}
    </Collapsible>
  );
}
