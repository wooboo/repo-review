/**
 * UI-facing shapes of the backend, exactly as agreed in docs/API.md "Contract v2".
 * Read models that Contract v2 keeps unchanged mirror the current server results,
 * plus the v2 additions (`about`, `jev`, dashboard counters).
 */
import type { Agent, Forge, Host, Settings, State, Verdict } from "@/domain/model";

export type { Agent, Forge, Host, Settings, State, Verdict };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type JobRef = { id: string };

// ---------- inventory read models (unchanged names, v2 additions)

export type About = { summary: string; description: string; kind: string; generatedAt: string };

export type RepositorySummary = {
  id: string;
  key: string;
  name: string;
  clones: number;
  branches: number;
  about: About | null;
};

export type Remote = {
  name: string;
  url: string;
  pushurl: string;
  key: string;
  defaultBranch: string;
  fetchError: string | null;
};

export type FileChange = { path: string; xy: string; mtime: string | null };

export type Worktree = {
  path: string;
  head: string;
  branch: string | null;
  main: boolean;
  exists: boolean;
  locked: boolean;
  prunable: boolean;
  detached: boolean;
  operations: readonly string[];
  submodules: readonly string[];
  dirty: boolean;
  files: readonly FileChange[];
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  error: string | null;
};

export type Thread = {
  id: string;
  branch: string | null;
  worktree: string | null;
  projectRoot: string | null;
  title: string;
  status: string;
};

export type BranchInfo = {
  name: string;
  sha: string;
  date: string;
  author: string;
  subject: string;
  upstream: string;
  upstreamGone: boolean;
  onRemotes: Readonly<Record<string, string>>;
  unpushed: number;
  unique: number;
  base: string | null;
  baseSha: string | null;
  mergeBase: string | null;
  vsBases: Readonly<Record<string, { ahead: number; behind: number }>>;
  ahead: number;
  behind: number;
  state: State;
  squashCommit: string | null;
  containedIn: readonly string[];
  commits: readonly string[];
  diffstat: string;
  residual: string;
};

export type Clone = {
  host: string;
  path: string;
  commonDir: string;
  name: string;
  key: string;
  roots: readonly string[];
  remotes: readonly Remote[];
  bases: readonly string[];
  branches: readonly BranchInfo[];
  remoteBranches: readonly BranchInfo[];
  worktrees: readonly Worktree[];
  stashes: readonly string[];
  threads: readonly Thread[];
  about: string;
  errors: readonly string[];
};

export type JevRecommendation = "delete" | "archive" | "keep" | "finish_and_merge";
export type Jev = { recommendation: JevRecommendation; confidence: number; flags: string[] };

export type BranchClone = BranchInfo & { host: string; path: string };

export type BranchGroup = {
  id: string;
  name: string;
  repo: string;
  verdict: Verdict;
  dirty: boolean;
  localOnly: boolean;
  stale: boolean;
  differentShas: boolean;
  date: string;
  clones: BranchClone[];
  jev: Jev | null;
};

export type RepositoryDetail = {
  key: string;
  clones: Clone[];
  branches: BranchGroup[];
  about: About | null;
};

export type WorktreeItem = Worktree & { id: string; name: string; host: string; repo: string };

export type ScanStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ScanEvent =
  | { type: "progress"; host: string; path: string }
  | { type: "host-complete"; host: string; repositories: number; errors: string[] }
  | { type: "forge-unavailable"; repo: string }
  | { type: string; [key: string]: unknown };
export type Scan = {
  id: string;
  status: ScanStatus;
  started: string;
  finished?: string;
  events: ScanEvent[];
  errors: string[];
  trigger?: string;
  hosts?: string[];
  fetch?: boolean;
};

export type Dashboard = {
  repositories: number;
  clones: number;
  branches: number;
  verdicts: Partial<Record<Verdict, number>>;
  dirtyWorktrees: number;
  runningScans: Scan[];
  openPullRequests: number;
  runningAgentRuns: number;
  lastScan: Scan | null;
  jevEnabled: boolean;
};

// ---------- list input

export type ListInput = {
  text?: string;
  host?: string;
  repo?: string;
  verdict?: Verdict;
  state?: State;
  stale?: boolean;
  dirty?: boolean;
  localOnly?: boolean;
  sort?: "name" | "date";
  page?: number;
  pageSize?: number;
};

// ---------- pull requests

export type ChecksState = "success" | "failure" | "pending" | "none";
export type ChecksSummary = { state: ChecksState; total: number; failed: number; pending: number };
export type PullRequestState = "open" | "merged" | "closed";
export type ReviewState = "approved" | "changes_requested" | "review_required" | "none";
export type PullRequest = {
  id: string;
  repo: string;
  forge: "github" | "forgejo";
  number: number;
  title: string;
  url: string;
  author: string;
  state: PullRequestState;
  draft: boolean;
  head: string;
  headSha: string;
  base: string;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  checks: ChecksSummary;
  review: ReviewState;
  mergeable: boolean | null;
};
export type PullRequestFile = { path: string; status: string; additions: number; deletions: number };
export type PullRequestDetail = PullRequest & {
  body: string;
  files: PullRequestFile[];
  diff: string;
  diffTruncated: boolean;
  checkRuns: { name: string; state: ChecksState; url: string | null }[];
  reviews: { author: string; state: string; body: string; at: string }[];
  comments: { author: string; body: string; at: string }[];
};
export type PullRequestQuery = {
  repo?: string;
  state?: PullRequestState | "all";
  text?: string;
  page: number;
  pageSize: number;
};
export type MergeMethod = "merge" | "squash" | "rebase";

// ---------- actions

export type ActionKind =
  | "delete-branch"
  | "archive-and-delete"
  | "switch-to-base"
  | "prune-worktree"
  | "fast-forward-base"
  | "push-branch"
  | "set-remote-url";
export type ActionTarget = {
  host: string;
  repo: string;
  branch?: string;
  worktree?: string;
  remote?: string;
  url?: string;
};
export type ActionStatus = "planned" | "skipped" | "blocked" | "running" | "done" | "failed";
export type PlannedAction = {
  id: string;
  kind: ActionKind;
  target: ActionTarget;
  branchId: string | null;
  repoKey: string;
  status: ActionStatus;
  reason: string;
  restore: string | null;
  createdAt: string;
  finishedAt: string | null;
};
export type PlanInput = {
  kind: ActionKind;
  branchIds?: string[];
  filter?: ListInput;
  targets?: ActionTarget[];
};

export type JobStatus = "running" | "done" | "failed";
export type Job<T> = { id: string; status: JobStatus; result: T | null; error: string | null };

// ---------- agents

export type AgentInfo = { id: string; label: string; kind: "acp" | "cli"; models: string[]; defaultModel: string };
export type AgentTask = "review-branch" | "make-pr" | "review-pr" | "cleanup-repo" | "describe-repo" | "custom";
export type WorktreeMode = "new" | "existing" | "none";
export type AgentRunInput = {
  agentId: string;
  model?: string;
  task: AgentTask;
  repo: string;
  host?: string;
  branchId?: string;
  pullRequestId?: string;
  note?: string;
  worktree: WorktreeMode;
};
export type AgentRunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type AgentRun = {
  id: string;
  agentId: string;
  model: string;
  task: AgentTask;
  repo: string;
  branchId: string | null;
  pullRequestId: string | null;
  cwd: string;
  status: AgentRunStatus;
  summary: string | null;
  costUsd: number | null;
  pullRequestUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
};
export type AgentEventKind = "message" | "thought" | "tool" | "permission" | "status" | "error";
export type AgentEvent = { seq: number; at: string; kind: AgentEventKind; text: string };
export type AgentRunDetail = { run: AgentRun; events: AgentEvent[]; cursor: number };
export type AgentRunQuery = { status?: AgentRunStatus; repo?: string; page: number; pageSize: number };

export type LiveEvent = { type: "scan" | "job" | "agent-run" | "inventory"; id: string };
