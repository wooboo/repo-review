/**
 * UI-facing shapes of the backend (docs/API.md). Contract v2 types come straight from the domain
 * schemas in `src/domain/model.ts`; read models without an exported schema mirror the server
 * results. Contract v3 additions are optional fields and separate types, marked TODO(contract-v3):
 * they become required once the backend implementing v3 is merged.
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
  ChecksSummary,
  Clone as DomainClone,
  Forge,
  Host,
  JevClassification,
  PlannedAction,
  PullRequest as DomainPullRequest,
  PullRequestDetail as DomainPullRequestDetail,
  Settings,
  State,
  Thread,
  Verdict,
  Worktree as DomainWorktree,
} from "@/domain/model";

export type { About, ActionKind, ActionTarget, Agent, AgentEvent, AgentInfo, AgentRun, AgentRunInput, AgentTask, ChecksSummary, Forge, Host, PlannedAction, Settings, State, Thread, Verdict };

/** TODO(contract-v3): v3 adds the "pr-merged" and "pr-merged-changed" clone states. */
export type BranchState = State | "pr-merged" | "pr-merged-changed";

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type JobRef = { id: string };

// ---------- Contract v3: pull-request provenance

export type LandingMethod = "merge" | "squash" | "rebase" | "unknown";
export type LandedVia = {
  pullRequestId: string;
  number: number;
  url: string;
  method: LandingMethod;
  mergeCommitSha: string | null;
  matchedSha: string;
  extraCommits: number;
  extraCommitShas: readonly string[];
};
export type PullRequestCommit = { sha: string; subject: string; author: string; at: string };
export type LandingVia = "merge-commit-sha" | "message" | "trailer" | "patch-id" | "none";
export type Landing = {
  sha: string;
  subject: string;
  author: string;
  at: string;
  base: string;
  pullRequestId: string | null;
  number: number | null;
  sourceBranch: string | null;
  method: LandingMethod | "direct";
  via: LandingVia;
  /** Local branches (live or gone) that landed in this commit. */
  branchIds: readonly string[];
};
export type BranchHistoryItem = {
  host: string;
  repo: string;
  clonePath: string;
  branch: string;
  sha: string;
  firstSeen: string;
  lastSeen: string;
  goneAt: string | null;
  landedVia: LandedVia | null;
};
export type LandingQuery = { repo: string; base?: string; since?: string; page: number; pageSize: number };
export type BranchHistoryQuery = { repo?: string; gone?: boolean; page: number; pageSize: number };

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
export type FileChange = DomainWorktree["files"][number];

// TODO(contract-v3): `missing` becomes required; until then it is derived from `exists === false`.
export type Worktree = DomainWorktree & { missing?: boolean };

// TODO(contract-v3): per-clone `landedVia` becomes required.
export type BranchInfo = DomainBranch & { landedVia?: LandedVia | null };

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
  /** TODO(contract-v3): branch-level provenance when every clone agrees. */
  landedVia?: LandedVia | null;
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

export type ChecksState = ChecksSummary["state"];
export type PullRequestState = DomainPullRequest["state"];
export type ReviewState = DomainPullRequest["review"];
/** TODO(contract-v3): merge commit, method and commit count become required. */
type ProvenanceFields = { mergeCommitSha?: string | null; mergeMethod?: LandingMethod | null; commitCount?: number };
export type PullRequest = DomainPullRequest & ProvenanceFields;
export type PullRequestFile = DomainPullRequestDetail["files"][number];
export type PullRequestDetail = DomainPullRequestDetail & ProvenanceFields & { commits?: readonly PullRequestCommit[] };
export type PullRequestQuery = {
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

export type JobStatus = "running" | "done" | "failed";
export type Job<T> = { id: string; status: JobStatus; result: T | null; error: string | null };

// ---------- agents

export type WorktreeMode = AgentRunInput["worktree"];
export type AgentRunStatus = AgentRun["status"];
export type AgentEventKind = AgentEvent["kind"];
export type AgentRunDetail = { run: AgentRun; events: readonly AgentEvent[]; cursor: number };
export type AgentRunQuery = { status?: AgentRunStatus; repo?: string; page: number; pageSize: number };

export type LiveEvent = { type: "scan" | "job" | "agent-run" | "inventory"; id: string };
