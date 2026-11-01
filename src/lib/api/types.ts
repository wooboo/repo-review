/**
 * UI-facing shapes of the backend (docs/API.md, Contracts v2 and v3). Types come straight from the
 * domain schemas in `src/domain/model.ts`; read models without an exported schema mirror the
 * server results.
 */
import type {
  About,
  ActionKind,
  ActionTarget,
  Agent,
  AgentEvent,
  AgentInfo,
  AgentRun,
  AgentRunInput,
  AgentTask,
  Branch as DomainBranch,
  BranchHistoryItem,
  ChecksSummary,
  Clone as DomainClone,
  Forge,
  ForgeBudget,
  Host,
  JevClassification,
  LandedVia,
  Landing,
  PlannedAction,
  PullRequest,
  PullRequestCommit,
  PullRequestDetail,
  Settings,
  State,
  Thread,
  Verdict,
  Worktree,
} from "@/domain/model";

export type {
  About,
  ActionKind,
  ActionTarget,
  Agent,
  AgentEvent,
  AgentInfo,
  AgentRun,
  AgentRunInput,
  AgentTask,
  BranchHistoryItem,
  ChecksSummary,
  Forge,
  ForgeBudget,
  Host,
  LandedVia,
  Landing,
  PlannedAction,
  PullRequest,
  PullRequestCommit,
  PullRequestDetail,
  Settings,
  State,
  Thread,
  Verdict,
  Worktree,
};

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type JobRef = { id: string };

export type LandingMethod = LandedVia["method"];
export type LandingVia = Landing["via"];
export type LandingQuery = { repo: string; base?: string; since?: string; page: number; pageSize: number };
export type BranchHistoryQuery = { text?: string; repo?: string; gone?: boolean; page: number; pageSize: number };

// ---------- inventory read models

export type RepositorySummary = {
  id: string;
  key: string;
  name: string;
  clones: number;
  branches: number;
  about: About | null;
};

export type Remote = DomainClone["remotes"][number];
export type FileChange = Worktree["files"][number];

export type BranchInfo = DomainBranch;

export type Clone = Omit<DomainClone, "branches" | "remoteBranches" | "worktrees"> & {
  host: string;
  branches: readonly BranchInfo[];
  remoteBranches: readonly BranchInfo[];
  worktrees: readonly Worktree[];
};

export type JevRecommendation = JevClassification["recommendation"];
export type Jev = JevClassification;

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
  /** Branch-level provenance when every clone agrees. */
  landedVia: LandedVia | null;
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
  forgeBudgets: ForgeBudget[];
  missingWorktrees: number;
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
  missing?: boolean;
  jev?: "delete" | "archive" | "keep" | "finish_and_merge";
  verdicts?: readonly Verdict[];
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

export type ChecksState = ChecksSummary["state"];
export type PullRequestState = PullRequest["state"];
export type ReviewState = PullRequest["review"];
export type PullRequestFile = PullRequestDetail["files"][number];
export type PullRequestQuery = {
  checks?: ChecksState;
  repo?: string;
  state?: PullRequestState | "all";
  text?: string;
  page: number;
  pageSize: number;
};
export type MergeMethod = "merge" | "squash" | "rebase";

// ---------- actions

export type ActionStatus = PlannedAction["status"];
export type PlanInput = {
  kind: ActionKind;
  branchIds?: string[];
  filter?: ListInput;
  targets?: ActionTarget[];
};

export type JobStatus = "running" | "done" | "failed" | "paused";
export type Job<T> = { id: string; status: JobStatus; result: T | null; error: string | null; errorType?: "ForgeRateLimited"; retryAt?: string };

// ---------- agents

export type WorktreeMode = AgentRunInput["worktree"];
export type AgentRunStatus = AgentRun["status"];
export type AgentEventKind = AgentEvent["kind"];
export type AgentRunDetail = { run: AgentRun; events: readonly AgentEvent[]; cursor: number };
export type AgentRunQuery = { status?: AgentRunStatus; repo?: string; page: number; pageSize: number };

export type LiveEvent = { type: "scan" | "job" | "agent-run" | "inventory" | "pull-requests"; id: string };
