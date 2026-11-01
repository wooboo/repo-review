/** Contract v2 transport: thin typed calls of the server functions. Business logic and jobs live on the server. */
import * as server from "@/server/functions";
import { allPages, MAX_PAGE, paginate } from "./pages";
import type {
  AgentInfo,
  AgentRun,
  AgentRunDetail,
  AgentRunInput,
  AgentRunQuery,
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

export { allPages, errorMessage, MAX_PAGE, paginate } from "./pages";

export async function getDashboard(): Promise<Dashboard> {
  const d = await server.getDashboard();
  return { ...d, verdicts: d.verdicts as Dashboard["verdicts"], runningScans: d.runningScans as Scan[], lastScan: d.lastScan as Scan | null };
}

export async function listRepositories(input: ListInput): Promise<Page<RepositorySummary>> {
  return server.listRepositories({ data: input });
}

export async function getRepository(id: string): Promise<RepositoryDetail> {
  return server.getRepository({ data: { id } });
}

/**
 * The UI offers several verdicts at once; ListInput accepts one. With two or more, every matching
 * page is fetched per verdict and merged here (kept until ListInput takes a verdict list).
 */
export async function searchBranches(input: Omit<ListInput, "verdict"> & { verdicts?: readonly Verdict[] }): Promise<Page<BranchGroup>> {
  const { verdicts = [], ...rest } = input;
  if (verdicts.length <= 1) return server.searchBranches({ data: { ...rest, verdict: verdicts[0] } });
  const rows = (
    await Promise.all(verdicts.map((verdict) => allPages((page) => server.searchBranches({ data: { ...rest, verdict, page, pageSize: MAX_PAGE } }))))
  ).flat();
  rows.sort((a, b) => (rest.sort === "date" ? b.date.localeCompare(a.date) : a.name.localeCompare(b.name)));
  return paginate(rows, rest.page ?? 1, rest.pageSize ?? 50);
}

export async function allBranches(input: ListInput = {}): Promise<BranchGroup[]> {
  return allPages((page) => server.searchBranches({ data: { ...input, page, pageSize: MAX_PAGE } }));
}

export async function getBranch(id: string): Promise<BranchGroup | null> {
  return server.getBranch({ data: { id } });
}

export async function allWorktrees(input: ListInput = {}): Promise<WorktreeItem[]> {
  return allPages((page) => server.listWorktrees({ data: { ...input, page, pageSize: MAX_PAGE } }));
}

export async function startScan(input: { hosts: string[]; fetch: boolean }): Promise<JobRef> {
  return server.startScan({ data: input });
}

export async function getScan(id: string): Promise<Scan | null> {
  return (await server.getScan({ data: { id } })) as Scan | null;
}

export async function listScans(): Promise<Scan[]> {
  return ((await server.listScans()) as Scan[]).sort((a, b) => b.started.localeCompare(a.started));
}

export async function getSettings(): Promise<Settings> {
  return server.getSettings();
}

export async function updateSettings(settings: Settings): Promise<Settings> {
  return server.updateSettings({ data: settings });
}

/** A background job; `result` decodes the job's JSON result for the caller's job kind. */
export async function getBackgroundJob<T>(id: string, result: (value: unknown) => T): Promise<Job<T> | null> {
  const job = await server.getBackgroundJob({ data: { id } });
  if (!job) return null;
  const status = job.status === "done" ? "done" : job.status === "failed" ? "failed" : "running";
  return { id: job.id, status, result: status === "done" ? result(job.result) : null, error: job.error ?? null };
}

export async function planActions(input: PlanInput): Promise<JobRef> {
  return server.planActions({ data: input });
}

export async function applyActions(ids: string[]): Promise<JobRef> {
  return server.applyActions({ data: { ids } });
}

export async function listActions(input: { status?: PlannedAction["status"]; repo?: string; page: number; pageSize: number }): Promise<Page<PlannedAction>> {
  return server.listActions({ data: input });
}

export async function listPullRequests(input: PullRequestQuery): Promise<Page<PullRequest>> {
  return server.listPullRequests({ data: input });
}

export async function allPullRequests(input: Omit<PullRequestQuery, "page" | "pageSize">): Promise<PullRequest[]> {
  return allPages((page) => listPullRequests({ ...input, page, pageSize: MAX_PAGE }));
}

export async function getPullRequest(id: string): Promise<PullRequestDetail | null> {
  return server.getPullRequest({ data: { id } });
}

export async function refreshPullRequests(input: { repo?: string }): Promise<JobRef> {
  return server.refreshPullRequests({ data: input });
}

export async function createPullRequest(input: { branchId: string; cloneHost?: string; base?: string; title: string; body: string; draft: boolean }): Promise<PullRequest> {
  return server.createPullRequest({ data: input });
}

export async function mergePullRequest(input: { id: string; method: MergeMethod; deleteRemoteBranch: boolean }): Promise<PullRequest> {
  return server.mergePullRequest({ data: input });
}

export async function closePullRequest(input: { id: string }): Promise<PullRequest> {
  return server.closePullRequest({ data: input });
}

export async function commentPullRequest(input: { id: string; body: string }): Promise<{ ok: true }> {
  return server.commentPullRequest({ data: input });
}

export async function listAgents(): Promise<readonly AgentInfo[]> {
  return server.listAgents();
}

export async function startAgentRun(input: AgentRunInput): Promise<JobRef> {
  return server.startAgentRun({ data: input });
}

export async function getAgentRun(id: string, cursor = 0): Promise<AgentRunDetail | null> {
  return server.getAgentRun({ data: { id, cursor } });
}

export async function listAgentRuns(input: AgentRunQuery): Promise<Page<AgentRun>> {
  return server.listAgentRuns({ data: input });
}

export async function cancelAgentRun(id: string): Promise<AgentRun> {
  return server.cancelAgentRun({ data: { id } });
}
