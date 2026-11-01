/**
 * Typed data access for the UI, exposing exactly the Contract v2 functions (docs/API.md).
 * Functions that already match v2 call the server function directly. The others are
 * adapters over the provisional functions, each marked TODO(contract-v2): replace the body
 * with the direct call once the backend-v2 branch is merged.
 */
import * as server from "@/server/functions";
import {
  mapAction,
  mapAgentEvent,
  mapAgentRun,
  mapJob,
  mapPullRequest,
  mapPullRequestDetail,
  parseBranchId,
  parsePullRequestId,
  pullRequestId,
} from "./adapters";
import { readmeSummary } from "@/lib/format";
import type {
  AgentInfo,
  AgentRun,
  AgentRunDetail,
  AgentRunInput,
  AgentRunQuery,
  AgentTask,
  BranchGroup,
  Dashboard,
  Job,
  JobRef,
  ListInput,
  MergeMethod,
  Page,
  PlanInput,
  PlannedAction,
  PullRequest,
  PullRequestDetail,
  PullRequestQuery,
  RepositoryDetail,
  RepositorySummary,
  Scan,
  Settings,
  Verdict,
  WorktreeItem,
} from "./types";

const ALL = 200;

function paginate<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const p = Math.max(1, page);
  return { items: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, page: p, pageSize };
}

async function allPages<T>(load: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const first = await load(1);
  const rows = [...first.items];
  for (let page = 2; page <= Math.ceil(first.total / ALL); page++) rows.push(...(await load(page)).items);
  return rows;
}

// ---------- local jobs: adapters that need several provisional calls run as a promise in the
// browser and are polled through getBackgroundJob like server jobs. TODO(contract-v2): remove.
const localJobs = new Map<string, { status: "running" | "done" | "failed"; result: unknown; error: string | null }>();
function localJob(work: () => Promise<unknown>): JobRef {
  const id = "local:" + crypto.randomUUID();
  localJobs.set(id, { status: "running", result: null, error: null });
  work().then(
    (result) => localJobs.set(id, { status: "done", result, error: null }),
    (e: unknown) => localJobs.set(id, { status: "failed", result: null, error: errorMessage(e) }),
  );
  return { id };
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^(Error: )+/, "");
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}

// ---------- inventory

export async function getDashboard(): Promise<Dashboard> {
  // TODO(contract-v2): openPullRequests, runningAgentRuns, lastScan and jevEnabled come from the server.
  // The provisional PR list refreshes from the forge on every call, so the dashboard only counts
  // pull requests this browser session has already loaded.
  const [d, scans, runs, prs] = await Promise.all([
    server.getDashboard(),
    listScans(),
    listAgentRuns({ status: "running", page: 1, pageSize: 1 }),
    cachedOpenPullRequests(),
  ]);
  return {
    ...d,
    verdicts: d.verdicts as Dashboard["verdicts"],
    runningScans: d.runningScans as Scan[],
    openPullRequests: prs,
    runningAgentRuns: runs.total,
    lastScan: scans[0] ?? null,
    jevEnabled: false,
  };
}

export async function listRepositories(input: ListInput): Promise<Page<RepositorySummary>> {
  // TODO(contract-v2): `about` is part of the server result; until then the first README paragraph of a clone.
  const page = await server.listRepositories({ data: input });
  const items = await Promise.all(
    page.items.map(async (r) => {
      const detail = await server.getRepository({ data: { id: r.key } }).catch(() => null);
      const summary = detail?.clones.map((c) => readmeSummary(c.about)).find(Boolean);
      return { ...r, about: summary ? { summary, description: "", kind: "readme", generatedAt: "" } : null };
    }),
  );
  return { ...page, items };
}

export async function getRepository(id: string): Promise<RepositoryDetail> {
  // TODO(contract-v2): `about` and `jev` are part of the server result.
  const r = await server.getRepository({ data: { id } });
  return { ...r, about: null, branches: r.branches.map((b) => ({ ...b, jev: null })) } as RepositoryDetail;
}

/** Branch search. `verdicts` is a multi-select; the server accepts one verdict per call. */
export async function searchBranches(input: Omit<ListInput, "verdict"> & { verdicts?: readonly Verdict[] }): Promise<Page<BranchGroup>> {
  const { verdicts = [], ...rest } = input;
  const withJev = (items: readonly object[]) => items.map((b) => ({ jev: null, ...b }) as BranchGroup);
  if (verdicts.length <= 1) {
    const page = await server.searchBranches({ data: { ...rest, verdict: verdicts[0] } });
    return { ...page, items: withJev(page.items) };
  }
  // TODO(contract-gap): ListInput.verdict should accept several verdicts; until then merge per-verdict results.
  const rows = (
    await Promise.all(
      verdicts.map((verdict) => allPages((page) => server.searchBranches({ data: { ...rest, verdict, page, pageSize: ALL } }))),
    )
  ).flat();
  rows.sort((a, b) => (rest.sort === "date" ? b.date.localeCompare(a.date) : a.name.localeCompare(b.name)));
  return paginate(withJev(rows), rest.page ?? 1, rest.pageSize ?? 50);
}

/** Every grouped branch (for per-repository verdict bars). */
export async function allBranches(input: ListInput = {}): Promise<BranchGroup[]> {
  // TODO(contract-gap): repository list items could carry verdict counts instead.
  const rows = await allPages((page) => server.searchBranches({ data: { ...input, page, pageSize: ALL } }));
  return rows.map((b) => ({ jev: null, ...b }) as BranchGroup);
}

export async function getBranch(id: string): Promise<BranchGroup | null> {
  // TODO(contract-v2): `jev` is part of the server result.
  const b = await server.getBranch({ data: { id } });
  return b ? ({ jev: null, ...b } as BranchGroup) : null;
}

export async function listWorktrees(input: ListInput): Promise<Page<WorktreeItem>> {
  return (await server.listWorktrees({ data: input })) as Page<WorktreeItem>;
}

export async function allWorktrees(input: ListInput = {}): Promise<WorktreeItem[]> {
  return allPages((page) => listWorktrees({ ...input, page, pageSize: ALL }));
}

/** host + clone path → repository key, from the main worktree of every clone. */
async function cloneKeys() {
  const rows = await allWorktrees();
  const map = new Map<string, string>();
  for (const w of rows) map.set(w.host + "\0" + w.path, w.repo);
  return {
    byHostPath: (host: string, path: string) => map.get(host + "\0" + path),
    byPath: (path: string) => rows.find((w) => w.path === path)?.repo,
    localClone: (repo: string) => rows.find((w) => w.repo === repo && w.main && w.host === "local") ?? rows.find((w) => w.repo === repo && w.main),
    worktreeOf: (repo: string, branch: string) => rows.find((w) => w.repo === repo && w.branch === branch && w.exists),
  };
}

// ---------- scans

export async function startScan(input: { hosts: string[]; fetch: boolean }): Promise<JobRef> {
  return server.startScan({ data: input });
}
export async function getScan(id: string): Promise<Scan | null> {
  return (await server.getScan({ data: { id } })) as Scan | null;
}
export async function listScans(): Promise<Scan[]> {
  const rows = (await server.listScans()) as Scan[];
  return [...rows].sort((a, b) => b.started.localeCompare(a.started));
}

// ---------- settings

export async function getSettings(): Promise<Settings> {
  return server.getSettings();
}
export async function updateSettings(settings: Settings): Promise<Settings> {
  return server.updateSettings({ data: settings });
}

// ---------- jobs

export async function getBackgroundJob<T>(id: string, result: (value: unknown) => T): Promise<Job<T> | null> {
  const local = localJobs.get(id);
  if (local) return { id, status: local.status, result: local.status === "done" ? result(local.result) : null, error: local.error };
  const raw = await server.getBackgroundJob({ data: { id } });
  return raw ? mapJob(raw, result) : null;
}

// ---------- actions

/** Plan a destructive action (dry run on the host). Resolves to a job whose result is PlannedAction[]. */
export async function planActions(input: PlanInput): Promise<JobRef> {
  // TODO(contract-v2): call server.planActions(input) directly.
  if (input.kind !== "delete-branch")
    throw Error("This action becomes available with the next backend version.");
  if (input.branchIds?.length) {
    const ids = input.branchIds;
    return localJob(async () => {
      const results: PlannedAction[] = [];
      for (const id of ids) {
        const b = parseBranchId(id);
        if (!b) continue;
        const job = await server.planCleanup({ data: { repo: b.repo, text: b.name, pageSize: ALL } });
        const done = await waitForJob(job.id, (v) => v);
        const planned = await withActionDetails(done);
        results.push(...planned.filter((a) => a.target.branch === b.name));
      }
      return results;
    });
  }
  const job = await server.planCleanup({ data: input.filter ?? {} });
  return localJob(async () => withActionDetails(await waitForJob(job.id, (v) => v)));
}

export async function applyActions(ids: string[]): Promise<JobRef> {
  // TODO(contract-v2): the server job returns PlannedAction[].
  const job = await server.applyActions({ data: { ids } });
  return localJob(async () => withActionDetails(await waitForJob(job.id, (v) => v)));
}

async function withActionDetails(results: unknown): Promise<PlannedAction[]> {
  const ids = new Set((Array.isArray(results) ? results : []).map((r: { id?: string }) => r.id));
  const [actions, keys] = await Promise.all([server.listActions(), cloneKeys()]);
  return (actions as unknown[])
    .filter((a) => ids.has((a as { id: string }).id))
    .map((a) => mapAction(a, keys.byHostPath));
}

export async function listActions(input: { status?: PlannedAction["status"]; repo?: string; page: number; pageSize: number }): Promise<Page<PlannedAction>> {
  // TODO(contract-v2): server-side filter and paging.
  const [actions, keys] = await Promise.all([server.listActions(), cloneKeys()]);
  const rows = (actions as unknown[])
    .map((a) => mapAction(a, keys.byHostPath))
    .filter((a) => (!input.status || a.status === input.status) && (!input.repo || a.repoKey === input.repo))
    .reverse();
  return paginate(rows, input.page, input.pageSize);
}

async function waitForJob<T>(id: string, result: (v: unknown) => T, interval = 1000): Promise<T> {
  for (;;) {
    const job = await getBackgroundJob(id, result);
    if (!job) throw Error("Job disappeared");
    if (job.status === "failed") throw Error(job.error ?? "Job failed");
    if (job.status === "done") return job.result as T;
    await new Promise((r) => setTimeout(r, interval));
  }
}

// ---------- pull requests

function forgeKind(settings: Settings, repo: string) {
  return settings.forges.find((f) => repo.startsWith(f.host + "/"))?.kind;
}

// The provisional listPullRequests refreshes from the forge on every call; keep a memo per repository.
const PR_TTL = 5 * 60_000;
const prMemo = new Map<string, { at: number; rows: Promise<PullRequest[]> }>();
async function cachedOpenPullRequests() {
  const rows = await Promise.all([...prMemo.values()].map((v) => v.rows.catch(() => [])));
  return rows.flat().filter((p) => p.state === "open").length;
}
async function pullRequestsOf(repo: string, settings: Settings, fresh = false): Promise<PullRequest[]> {
  const kind = forgeKind(settings, repo);
  if (!kind) return [];
  const hit = prMemo.get(repo);
  if (!fresh && hit && Date.now() - hit.at < PR_TTL) return hit.rows;
  const rows = server.listPullRequests({ data: { id: repo } }).then(({ json }) => {
    const raw: unknown = JSON.parse(json);
    return (Array.isArray(raw) ? raw : []).map((p) => mapPullRequest(p, repo, kind));
  });
  prMemo.set(repo, { at: Date.now(), rows });
  rows.catch(() => prMemo.delete(repo));
  return rows;
}

async function forgeRepos(settings: Settings, repo?: string) {
  if (!settings.forges.length) return [];
  if (repo) return [repo];
  const repos = await allPages((page) => server.listRepositories({ data: { page, pageSize: ALL } }));
  return repos.map((r) => r.key).filter((k) => forgeKind(settings, k));
}

export async function listPullRequests(input: PullRequestQuery): Promise<Page<PullRequest>> {
  // TODO(contract-v2): call server.listPullRequests(input) (cached server-side, all repositories).
  const settings = await getSettings();
  const repos = await forgeRepos(settings, input.repo);
  const settled = await Promise.allSettled(repos.map((r) => pullRequestsOf(r, settings)));
  const text = input.text?.toLowerCase() ?? "";
  const state = input.state ?? "open";
  const rows = settled
    .flatMap((s) => (s.status === "fulfilled" ? s.value : []))
    .filter((p) => (state === "all" || p.state === state) && (!text || `${p.title} ${p.head} ${p.repo} #${p.number}`.toLowerCase().includes(text)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (repos.length && settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
  return paginate(rows, input.page, input.pageSize);
}

export async function getPullRequest(id: string): Promise<PullRequestDetail | null> {
  // TODO(contract-v2): call server.getPullRequest({ id }).
  const ref = parsePullRequestId(id);
  if (!ref) return null;
  const settings = await getSettings();
  const kind = forgeKind(settings, ref.repo);
  if (!kind) return null;
  const { json } = await server.getPullRequest({ data: ref });
  return mapPullRequestDetail(JSON.parse(json), ref.repo, kind);
}

export async function refreshPullRequests(input: { repo?: string }): Promise<JobRef> {
  // TODO(contract-v2): server job.
  return localJob(async () => {
    const settings = await getSettings();
    const repos = await forgeRepos(settings, input.repo);
    await Promise.allSettled(repos.map((r) => pullRequestsOf(r, settings, true)));
    return null;
  });
}

async function forgeOperation(repo: string, operation: "create" | "merge" | "close" | "comment", payload: Record<string, unknown>) {
  // TODO(contract-v2): replaced by typed create/merge/close/comment functions.
  const { json } = await server.forgeOperation({ data: { repo, operation, json: JSON.stringify(payload) } });
  prMemo.delete(repo);
  return JSON.parse(json) as unknown;
}

export async function createPullRequest(input: { branchId: string; cloneHost?: string; base?: string; title: string; body: string; draft: boolean }): Promise<PullRequest> {
  // TODO(contract-v2): call server.createPullRequest(input); it also pushes the branch first.
  const b = parseBranchId(input.branchId);
  if (!b) throw Error("Invalid branch id");
  const settings = await getSettings();
  const kind = forgeKind(settings, b.repo);
  if (!kind) throw Error("No forge configured for this repository");
  const raw = await forgeOperation(b.repo, "create", { title: input.title, head: b.name, base: input.base, body: input.body, draft: input.draft });
  return mapPullRequest(raw, b.repo, kind);
}

export async function mergePullRequest(input: { id: string; method: MergeMethod; deleteRemoteBranch: boolean }): Promise<PullRequest> {
  // TODO(contract-v2): call server.mergePullRequest(input).
  const ref = parsePullRequestId(input.id);
  if (!ref) throw Error("Invalid pull request id");
  const settings = await getSettings();
  const kind = forgeKind(settings, ref.repo);
  await forgeOperation(
    ref.repo,
    "merge",
    kind === "github" ? { number: ref.number, merge_method: input.method } : { number: ref.number, Do: input.method, delete_branch_after_merge: input.deleteRemoteBranch },
  );
  const pr = await getPullRequest(input.id);
  if (!pr) throw Error("Pull request not found");
  return pr;
}

export async function closePullRequest(input: { id: string }): Promise<PullRequest> {
  // TODO(contract-v2): call server.closePullRequest(input).
  const ref = parsePullRequestId(input.id);
  if (!ref) throw Error("Invalid pull request id");
  await forgeOperation(ref.repo, "close", { number: ref.number });
  const pr = await getPullRequest(input.id);
  if (!pr) throw Error("Pull request not found");
  return pr;
}

export async function commentPullRequest(input: { id: string; body: string }): Promise<{ ok: true }> {
  // TODO(contract-v2): call server.commentPullRequest(input).
  const ref = parsePullRequestId(input.id);
  if (!ref) throw Error("Invalid pull request id");
  await forgeOperation(ref.repo, "comment", { number: ref.number, body: input.body });
  return { ok: true };
}

// ---------- agents

export async function listAgents(): Promise<AgentInfo[]> {
  // TODO(contract-v2): call server.listAgents().
  const settings = await getSettings();
  return settings.agents.map((a) => ({ id: a.id, label: a.label, kind: a.kind, models: [...a.models], defaultModel: a.defaultModel }));
}

// TODO(contract-v2): the server builds prompts from task templates.
const templates: Record<AgentTask, (target: string) => string> = {
  "review-branch": (t) => `Review the branch ${t}. Summarise what it changes, whether it is still needed, and what should happen to it (merge, PR, archive or delete). Do not push or delete anything.`,
  "make-pr": (t) => `Prepare ${t} for a pull request: rebase or merge the base if needed, make the change complete, and open a pull request with a clear description.`,
  "review-pr": (t) => `Review the pull request ${t}. Point out bugs, risks and missing tests, and summarise whether it is ready to merge.`,
  "cleanup-repo": (t) => `Look at the repository ${t} and propose a cleanup of stale branches, worktrees and stashes. Do not delete anything.`,
  "describe-repo": (t) => `Describe the repository ${t} briefly: what it is, its stack and its current state.`,
  custom: (t) => `Work in ${t}.`,
};

export async function startAgentRun(input: AgentRunInput): Promise<JobRef> {
  // TODO(contract-v2): call server.startAgentRun(input).
  const keys = await cloneKeys();
  const clone = keys.localClone(input.repo);
  if (!clone) throw Error("No local clone of this repository; agent runs are local for now.");
  const branch = (input.branchId && parseBranchId(input.branchId)?.name) || clone.branch || "HEAD";
  const target = input.pullRequestId ?? input.branchId ?? input.repo;
  const prompt = [templates[input.task](target), input.note?.trim()].filter(Boolean).join("\n\n");
  const existing = input.worktree === "existing" ? keys.worktreeOf(input.repo, branch)?.path : input.worktree === "none" ? clone.path : undefined;
  if (input.worktree === "existing" && !existing) throw Error("The branch has no worktree; choose a new worktree instead.");
  return server.startAgentRun({
    data: {
      agent: input.agentId,
      repo: clone.path,
      branch,
      prompt,
      model: input.model,
      existingWorktree: existing,
      task: input.task === "describe-repo" ? "custom" : input.task,
    },
  });
}

export async function getAgentRun(id: string, cursor = 0): Promise<AgentRunDetail | null> {
  // TODO(contract-v2): call server.getAgentRun({ id, cursor }).
  const [raw, keys] = await Promise.all([server.getAgentRun({ data: { id, cursor } }), cloneKeys()]);
  if (!raw) return null;
  const events = (raw.events as unknown[]).map((e, i) => mapAgentEvent(e, cursor + i));
  return { run: mapAgentRun(raw, keys.byPath), events, cursor: raw.cursor };
}

export async function listAgentRuns(input: AgentRunQuery): Promise<Page<AgentRun>> {
  // TODO(contract-v2): call server.listAgentRuns(input).
  const [raw, keys] = await Promise.all([server.listAgentRuns(), cloneKeys()]);
  const rows = (raw as unknown[])
    .map((r) => mapAgentRun(r, keys.byPath))
    .filter((r) => (!input.status || r.status === input.status) && (!input.repo || r.repo === input.repo))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return paginate(rows, input.page, input.pageSize);
}

export async function cancelAgentRun(id: string): Promise<AgentRun> {
  // TODO(contract-v2): call server.cancelAgentRun({ id }) which returns AgentRun.
  await server.cancelAgentRun({ data: { id } });
  const detail = await getAgentRun(id, Number.MAX_SAFE_INTEGER);
  if (!detail) throw Error("Run not found");
  return detail.run;
}

export { pullRequestId };
