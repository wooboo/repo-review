import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "@tanstack/react-router";
import * as api from "@/lib/api/client";
import type { AgentRunQuery, ListInput, LiveEvent, PlannedAction, PullRequestQuery, Verdict } from "@/lib/api/types";

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
  pr: (id: string) => queryOptions({ queryKey: ["pr", id], queryFn: () => api.getPullRequest(id), staleTime: 60_000 }),
  agents: () => queryOptions({ queryKey: ["agents"], queryFn: api.listAgents, staleTime: 5 * 60_000 }),
  runs: (input: AgentRunQuery) => queryOptions({ queryKey: ["runs", input], queryFn: () => api.listAgentRuns(input) }),
  actions: (input: { page: number; pageSize: number }) => queryOptions({ queryKey: ["actions", input], queryFn: () => api.listActions(input) }),
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

export function invalidateFor(client: QueryClient, event: LiveEvent) {
  switch (event.type) {
    case "scan":
      void client.invalidateQueries({ queryKey: ["scans"] });
      void client.invalidateQueries({ queryKey: ["inv", "dashboard"] });
      break;
    case "inventory":
      void client.invalidateQueries({ queryKey: ["inv"] });
      void client.invalidateQueries({ queryKey: ["prs"] });
      break;
    case "job":
      void client.invalidateQueries({ queryKey: ["job", event.id] });
      break;
    case "agent-run":
      void client.invalidateQueries({ queryKey: ["runs"] });
      void client.invalidateQueries({ queryKey: ["run", event.id] });
      break;
  }
}

/**
 * Mounted once in the shell. SSE is used only when the route tree has the /api/events route
 * (Contract v2), so a missing endpoint never costs a failing request.
 */
export function useLiveUpdates() {
  const client = useQueryClient();
  const router = useRouter();
  const hasEvents = "/api/events" in router.routesByPath;
  useEffect(() => {
    if (!hasEvents || typeof EventSource === "undefined") return setMode("poll");
    const source = new EventSource("/api/events");
    source.onopen = () => setMode("sse");
    source.onmessage = (e: MessageEvent<string>) => {
      try {
        invalidateFor(client, JSON.parse(e.data) as LiveEvent);
      } catch {
        /* ignore malformed events */
      }
    };
    source.onerror = () => {
      // A missing endpoint closes the stream for good; a dropped one reconnects by itself.
      if (source.readyState === EventSource.CLOSED || mode !== "sse") {
        source.close();
        setMode("poll");
      }
    };
    return () => source.close();
  }, [client, hasEvents]);
}

/** Polls a job until it is done or failed. */
export function useJob<T>(id: string | null, result: (v: unknown) => T) {
  return useQuery({
    ...q.job(id ?? "", result),
    enabled: id !== null,
    refetchInterval: (query) => (query.state.data?.status === "running" || !query.state.data ? 1000 : false),
  });
}
