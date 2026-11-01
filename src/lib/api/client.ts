/** Contract v2 transport. Business logic and long-running jobs live on the server. */
import * as server from "@/server/functions";
import { mapJob, pullRequestId } from "./adapters";
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
const ALL = 200;
function paginate<T>(rows: T[], page: number, pageSize: number): Page<T> {
  const p = Math.max(1, page);
  return {
    items: rows.slice((p - 1) * pageSize, p * pageSize),
    total: rows.length,
    page: p,
    pageSize,
  };
}
async function allPages<T>(
  load: (page: number) => Promise<Page<T>>,
): Promise<T[]> {
  const first = await load(1),
    rows = [...first.items];
  for (let page = 2; page <= Math.ceil(first.total / ALL); page++)
    rows.push(...(await load(page)).items);
  return rows;
}
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^(Error: )+/, "");
  if (
    e &&
    typeof e === "object" &&
    "message" in e &&
    typeof e.message === "string"
  )
    return e.message;
  return String(e);
}
type BackendBranch = NonNullable<Awaited<ReturnType<typeof server.getBranch>>>;
const branch = (b: BackendBranch): BranchGroup => ({
  ...b,
  jev: b.jev ? { ...b.jev, flags: [...b.jev.flags] } : null,
});
export async function getDashboard(): Promise<Dashboard> {
  const d = await server.getDashboard();
  return {
    ...d,
    verdicts: d.verdicts as Dashboard["verdicts"],
    runningScans: d.runningScans as Scan[],
    lastScan: d.lastScan as Scan | null,
  };
}
export async function listRepositories(
  input: ListInput,
): Promise<Page<RepositorySummary>> {
  return server.listRepositories({ data: input });
}
export async function getRepository(id: string): Promise<RepositoryDetail> {
  const r = await server.getRepository({ data: { id } });
  return { ...r, branches: r.branches.map(branch) };
}
/** The UI offers multiple verdicts; the contract accepts one per request. */
export async function searchBranches(
  input: Omit<ListInput, "verdict"> & { verdicts?: readonly Verdict[] },
): Promise<Page<BranchGroup>> {
  const { verdicts = [], ...rest } = input;
  if (verdicts.length <= 1) {
    const p = await server.searchBranches({
      data: { ...rest, verdict: verdicts[0] },
    });
    return { ...p, items: p.items.map(branch) };
  }
  const rows = (
    await Promise.all(
      verdicts.map((verdict) =>
        allPages((page) =>
          server.searchBranches({
            data: { ...rest, verdict, page, pageSize: ALL },
          }),
        ),
      ),
    )
  ).flat();
  rows.sort((a, b) =>
    rest.sort === "date"
      ? b.date.localeCompare(a.date)
      : a.name.localeCompare(b.name),
  );
  return paginate(rows.map(branch), rest.page ?? 1, rest.pageSize ?? 50);
}
export async function allBranches(
  input: ListInput = {},
): Promise<BranchGroup[]> {
  return (
    await allPages((page) =>
      server.searchBranches({ data: { ...input, page, pageSize: ALL } }),
    )
  ).map(branch);
}
export async function getBranch(id: string): Promise<BranchGroup | null> {
  const b = await server.getBranch({ data: { id } });
  return b ? branch(b) : null;
}
export async function listWorktrees(
  input: ListInput,
): Promise<Page<WorktreeItem>> {
  return server.listWorktrees({ data: input });
}
export async function allWorktrees(
  input: ListInput = {},
): Promise<WorktreeItem[]> {
  return allPages((page) => listWorktrees({ ...input, page, pageSize: ALL }));
}
export async function startScan(input: {
  hosts: string[];
  fetch: boolean;
}): Promise<JobRef> {
  return server.startScan({ data: input });
}
export async function getScan(id: string): Promise<Scan | null> {
  return (await server.getScan({ data: { id } })) as Scan | null;
}
export async function listScans(): Promise<Scan[]> {
  return ((await server.listScans()) as Scan[]).sort((a, b) =>
    b.started.localeCompare(a.started),
  );
}
export async function getSettings(): Promise<Settings> {
  return server.getSettings();
}
export async function updateSettings(settings: Settings): Promise<Settings> {
  return server.updateSettings({ data: settings });
}
export async function getBackgroundJob<T>(
  id: string,
  result: (value: unknown) => T,
): Promise<Job<T> | null> {
  const raw = await server.getBackgroundJob({ data: { id } });
  return raw ? mapJob(raw, result) : null;
}
export async function planActions(input: PlanInput): Promise<JobRef> {
  return server.planActions({ data: input });
}
export async function applyActions(ids: string[]): Promise<JobRef> {
  return server.applyActions({ data: { ids } });
}
export async function listActions(input: {
  status?: PlannedAction["status"];
  repo?: string;
  page: number;
  pageSize: number;
}): Promise<Page<PlannedAction>> {
  return server.listActions({ data: input });
}
export async function listPullRequests(
  input: PullRequestQuery,
): Promise<Page<PullRequest>> {
  return server.listPullRequests({ data: input });
}
export async function getPullRequest(
  id: string,
): Promise<PullRequestDetail | null> {
  const p = await server.getPullRequest({ data: { id } });
  return p
    ? {
        ...p,
        files: [...p.files],
        checkRuns: [...p.checkRuns],
        reviews: [...p.reviews],
        comments: [...p.comments],
      }
    : null;
}
export async function refreshPullRequests(input: {
  repo?: string;
}): Promise<JobRef> {
  return server.refreshPullRequests({ data: input });
}
export async function createPullRequest(input: {
  branchId: string;
  cloneHost?: string;
  base?: string;
  title: string;
  body: string;
  draft: boolean;
}): Promise<PullRequest> {
  return server.createPullRequest({ data: input });
}
export async function mergePullRequest(input: {
  id: string;
  method: MergeMethod;
  deleteRemoteBranch: boolean;
}): Promise<PullRequest> {
  return server.mergePullRequest({ data: input });
}
export async function closePullRequest(input: {
  id: string;
}): Promise<PullRequest> {
  return server.closePullRequest({ data: input });
}
export async function commentPullRequest(input: {
  id: string;
  body: string;
}): Promise<{ ok: true }> {
  return server.commentPullRequest({ data: input });
}
export async function listAgents(): Promise<AgentInfo[]> {
  return (await server.listAgents()).map((a) => ({
    ...a,
    models: [...a.models],
  }));
}
export async function startAgentRun(input: AgentRunInput): Promise<JobRef> {
  return server.startAgentRun({ data: input });
}
export async function getAgentRun(
  id: string,
  cursor = 0,
): Promise<AgentRunDetail | null> {
  return server.getAgentRun({ data: { id, cursor } });
}
export async function listAgentRuns(
  input: AgentRunQuery,
): Promise<Page<AgentRun>> {
  return server.listAgentRuns({ data: input });
}
export async function cancelAgentRun(id: string): Promise<AgentRun> {
  return server.cancelAgentRun({ data: { id } });
}
export { pullRequestId };
