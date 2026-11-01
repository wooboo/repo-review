import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import * as api from "@/lib/api/client";
import type { AgentRunQuery, BranchHistoryQuery, LandingQuery, ListInput, LiveEvent, PlannedAction, PullRequestQuery, Verdict } from "@/lib/api/types";

/** Inventory queries share the "inv" prefix so a finished scan can refresh all of them at once. */
export const q = {
  dashboard: () => queryOptions({ queryKey: ["inv", "dashboard"], queryFn: api.getDashboard }),
  repos: (input: ListInput) => queryOptions({ queryKey: ["inv", "repos", input], queryFn: () => api.listRepositories(input) }),
  repo: (id: string) => queryOptions({ queryKey: ["inv", "repo", id], queryFn: () => api.getRepository(id) }),
  branches: (input: Omit<ListInput, "verdict"> & { verdicts?: readonly Verdict[] }) =>
    queryOptions({ queryKey: ["inv", "branches", input], queryFn: () => api.searchBranches(input) }),
  allBranches: () => queryOptions({ queryKey: ["inv", "branches", "all"], queryFn: () => api.allBranches(), staleTime: 60_000 }),
  branch: (id: string) => queryOptions({ queryKey: ["inv", "branch", id], queryFn: () => api.getBranch(id) }),
  worktrees: (input: ListInput) => queryOptions({ queryKey: ["inv", "worktrees", input], queryFn: () => api.allWorktrees(input) }),
  scans: () => queryOptions({ queryKey: ["scans"], queryFn: api.listScans }),
  scan: (id: string) => queryOptions({ queryKey: ["scans", id], queryFn: () => api.getScan(id) }),
  settings: () => queryOptions({ queryKey: ["settings"], queryFn: api.getSettings, staleTime: 5 * 60_000 }),
  prs: (input: PullRequestQuery) => queryOptions({ queryKey: ["prs", input], queryFn: () => api.listPullRequests(input), staleTime: 60_000 }),
  /** Every PR of the cache (all pages), for branch ↔ PR badges. */
  allPrs: (input: Omit<PullRequestQuery, "page" | "pageSize">) => queryOptions({ queryKey: ["prs", "all", input], queryFn: () => api.allPullRequests(input), staleTime: 60_000 }),
  pr: (id: string) => queryOptions({ queryKey: ["pr", id], queryFn: () => api.getPullRequest(id), staleTime: 60_000 }),
  agents: () => queryOptions({ queryKey: ["agents"], queryFn: api.listAgents, staleTime: 5 * 60_000 }),
  runs: (input: AgentRunQuery) => queryOptions({ queryKey: ["runs", input], queryFn: () => api.listAgentRuns(input) }),
  actions: (input: { page: number; pageSize: number }) => queryOptions({ queryKey: ["actions", input], queryFn: () => api.listActions(input) }),
  landings: (input: LandingQuery) => queryOptions({ queryKey: ["inv", "landings", input], queryFn: () => api.listLandings(input) }),
  history: (input: BranchHistoryQuery) => queryOptions({ queryKey: ["inv", "history", input], queryFn: () => api.listBranchHistory(input) }),
  job: <T>(id: string, result: (v: unknown) => T) => queryOptions({ queryKey: ["job", id], queryFn: () => api.getBackgroundJob(id, result) }),
};

export const asActions = (v: unknown) => (Array.isArray(v) ? (v as PlannedAction[]) : []);

// ---------- live updates: SSE when the server offers /api/events, otherwise 2 s polling.

type Mode = "connecting" | "sse" | "poll";
let mode: Mode = "connecting";
const modeListeners = new Set<() => void>();
const setMode = (next: Mode) => {
  mode = next;
  modeListeners.forEach((l) => l());
};
export const useLiveMode = () =>
  useSyncExternalStore(
    (l) => (modeListeners.add(l), () => modeListeners.delete(l)),
    () => mode,
    () => "connecting" as Mode,
  );

export const POLL_MS = 2000;
/** Poll interval for a query that changes while something runs; off when SSE pushes changes. */
export function usePoll(active: boolean): number | false {
  const live = useLiveMode();
  return active && live !== "sse" ? POLL_MS : false;
}

/** Query key prefixes a live event invalidates. */
export function keysFor(event: LiveEvent): string[][] {
  switch (event.type) {
    case "scan":
      return [["scans"], ["inv", "dashboard"]];
    case "inventory":
      return [["inv"], ["prs"], ["pr"]];
    case "job":
      return [["job", event.id]];
    case "agent-run":
      return [["runs"], ["run", event.id]];
    default:
      return [];
  }
}

/**
 * Coalesces live events: a sync job can emit one event per pull request, so invalidations are
 * collected and flushed at most once per `delay` ms instead of refetching every view per event.
 */
export function coalescer(flush: (keys: string[][]) => void, delay = 1000, schedule: (f: () => void, ms: number) => unknown = setTimeout) {
  const pending = new Map<string, string[]>();
  let scheduled = false;
  return (event: LiveEvent) => {
    for (const key of keysFor(event)) pending.set(JSON.stringify(key), key);
    if (scheduled || !pending.size) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const keys = [...pending.values()];
      pending.clear();
      flush(keys);
    }, delay);
  };
}

/** Mounted once in the shell: SSE invalidation hints from /api/events, 2 s polling when the stream fails. */
export function useLiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return setMode("poll");
    const push = coalescer((keys) => keys.forEach((queryKey) => void client.invalidateQueries({ queryKey })));
    const source = new EventSource("/api/events");
    source.onopen = () => {
      // Events are hints, not a replay log: refetch whatever changed while disconnected.
      if (mode === "poll") void client.invalidateQueries();
      setMode("sse");
    };
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        push(JSON.parse(e.data) as LiveEvent);
      } catch {
        /* ignore malformed events */
      }
    };
    source.onerror = () => {
      // A stream that never opened falls back to polling for good; a dropped one reconnects by
      // itself, and the views poll until it is back.
      if (source.readyState === EventSource.CLOSED || mode === "connecting") source.close();
      setMode("poll");
    };
    return () => source.close();
  }, [client]);
}

/** Polls a job until it is done or failed. */
export function useJob<T>(id: string | null, result: (v: unknown) => T) {
  return useQuery({
    ...q.job(id ?? "", result),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 1000 : false),
  });
}
