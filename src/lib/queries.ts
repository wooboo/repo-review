import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import * as api from "@/lib/api/client";
import { errorMessage } from "@/lib/api/pages";
import { repoName } from "@/lib/format";
import { toast } from "@/lib/toast";
import { m } from "@/messages";
import type { AgentRunQuery, BranchHistoryQuery, LandingQuery, ListInput, LiveEvent, Page, PlannedAction, PullRequestQuery, RepositoryDetail, RepositorySummary, Verdict, Visibility } from "@/lib/api/types";

/** Inventory queries share the "inv" prefix so a finished scan can refresh all of them at once. */
export const q = {
  dashboard: () => queryOptions({ queryKey: ["inv", "dashboard"], queryFn: api.getDashboard }),
  repos: (input: ListInput) => queryOptions({ queryKey: ["inv", "repos", input], queryFn: () => api.listRepositories(input) }),
  repo: (id: string) => queryOptions({ queryKey: ["inv", "repo", id], queryFn: () => api.getRepository(id) }),
  branches: (input: Omit<ListInput, "verdict"> & { verdicts?: readonly Verdict[] }) =>
    queryOptions({ queryKey: ["inv", "branches", input], queryFn: () => api.searchBranches(input) }),
  allBranches: (input: Visibility = {}) => queryOptions({ queryKey: ["inv", "branches", "all", input], queryFn: () => api.allBranches(input), staleTime: 60_000 }),
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
  /** Tombstones of deleted repositories; under "inv" so a purge's inventory event refreshes it. */
  deletedRepos: () => queryOptions({ queryKey: ["inv", "deleted"], queryFn: api.listDeletedRepositories }),
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
    case "pull-requests":
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
    refetchInterval: (query) => (["running", "paused"].includes(query.state.data?.status ?? "") || !query.state.data ? 1000 : false),
  });
}

// ---------- mute (Contract v4.1)

/**
 * Optimistically applies a mute change to cached repository lists and details: lists that hide
 * muted repositories drop a newly muted row at once, lists that show them update its flag.
 */
export function applyMuted(client: QueryClient, repositoryId: string, muted: boolean) {
  for (const [key, data] of client.getQueriesData<Page<RepositorySummary>>({ queryKey: ["inv", "repos"] })) {
    if (!data) continue;
    const input = (key[2] ?? {}) as ListInput;
    const hide = muted && !input.includeMuted;
    const items = hide ? data.items.filter((r) => r.key !== repositoryId) : data.items.map((r) => (r.key === repositoryId ? { ...r, muted } : r));
    client.setQueryData(key, { ...data, items, total: data.total - (data.items.length - items.length) });
  }
  client.setQueryData<RepositoryDetail>(["inv", "repo", repositoryId], (r) => (r ? { ...r, muted } : r));
}

/**
 * Mute or unmute a repository: optimistic flag, rollback on error, then every list refetches.
 * Feedback lives in the hook-level callbacks because a newly muted row unmounts right away.
 */
export function useSetMuted() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { repositoryId: string; muted: boolean }) => api.setRepositoryMuted(input),
    onMutate: async ({ repositoryId, muted }) => {
      await client.cancelQueries({ queryKey: ["inv"] });
      const snapshot = [...client.getQueriesData({ queryKey: ["inv", "repos"] }), ...client.getQueriesData({ queryKey: ["inv", "repo", repositoryId] })];
      applyMuted(client, repositoryId, muted);
      return { snapshot };
    },
    onError: (e, _input, context) => {
      for (const [key, data] of context?.snapshot ?? []) client.setQueryData(key, data);
      toast(errorMessage(e));
    },
    onSuccess: ({ repositoryId, muted }) => {
      const name = repoName(repositoryId);
      toast(muted ? m.mute.done(name) : m.mute.undone(name), {
        action: { label: m.mute.undo, onClick: () => mutation.mutate({ repositoryId, muted: !muted }) },
      });
    },
    onSettled: () => {
      // Lists, counts and the PR cache all filter muted repositories on the server.
      void client.invalidateQueries({ queryKey: ["inv"] });
      void client.invalidateQueries({ queryKey: ["prs"] });
    },
  });
  return mutation;
}
