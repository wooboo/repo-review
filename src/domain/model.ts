import { Schema } from "effect";
export const State = Schema.Literals([
  "base",
  "merged",
  "patch-merged",
  "squash-merged",
  "content-in-base",
  "unmerged",
  "no-base",
]);
export type State = typeof State.Type;
export const Verdict = Schema.Literals([
  "base",
  "delete",
  "check",
  "pr-open",
  "local-only",
  "pr-closed",
  "pr-merged-changed",
  "unmerged",
]);
export type Verdict = typeof Verdict.Type;
export const Host = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["local", "ssh"]),
  target: Schema.optional(Schema.String),
  bun: Schema.optional(Schema.String),
  roots: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
});
export type Host = typeof Host.Type;
export const Forge = Schema.Struct({
  host: Schema.String,
  kind: Schema.Literals(["github", "forgejo"]),
  tokenEnv: Schema.optional(Schema.String),
  tokenCommand: Schema.optional(Schema.String),
});
export type Forge = typeof Forge.Type;
export const Agent = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["cli", "acp"]),
  command: Schema.String,
  args: Schema.Array(Schema.String),
  models: Schema.Array(Schema.String),
  defaultModel: Schema.String,
});
export type Agent = typeof Agent.Type;
export const Settings = Schema.Struct({
  hosts: Schema.Array(Host),
  forges: Schema.Array(Forge),
  agents: Schema.Array(Agent),
  staleDays: Schema.Number,
  worktreeDir: Schema.String,
  dailyScanTime: Schema.String,
});
export type Settings = typeof Settings.Type;
export const Thread = Schema.Struct({
  id: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktree: Schema.NullOr(Schema.String),
  projectRoot: Schema.NullOr(Schema.String),
  title: Schema.String,
  status: Schema.String,
});
export type Thread = typeof Thread.Type;
export const FileChange = Schema.Struct({
  path: Schema.String,
  xy: Schema.String,
  mtime: Schema.NullOr(Schema.String),
});
export const Worktree = Schema.Struct({
  newestChangeAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastGitActivityAt: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.String,
  head: Schema.String,
  branch: Schema.NullOr(Schema.String),
  main: Schema.Boolean,
  exists: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
  detached: Schema.Boolean,
  operations: Schema.Array(Schema.String),
  submodules: Schema.Array(Schema.String),
  dirty: Schema.Boolean,
  files: Schema.Array(FileChange),
  total: Schema.Number,
  staged: Schema.Number,
  unstaged: Schema.Number,
  untracked: Schema.Number,
  conflicts: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export type Worktree = typeof Worktree.Type;
export const Divergence = Schema.Struct({
  ahead: Schema.Number,
  behind: Schema.Number,
});
export const Branch = Schema.Struct({
  authorDate: Schema.optional(Schema.String),
  mergeBaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  baseMovedAt: Schema.optional(Schema.NullOr(Schema.String)),
  firstOwnCommitAt: Schema.optional(Schema.NullOr(Schema.String)),
  lastOwnCommitAt: Schema.optional(Schema.NullOr(Schema.String)),
  cherryApplied: Schema.optional(Schema.Number),
  cherryUnapplied: Schema.optional(Schema.Number),
  upstreamAhead: Schema.optional(Schema.Number),
  upstreamBehind: Schema.optional(Schema.Number),
  name: Schema.String,
  sha: Schema.String,
  date: Schema.String,
  author: Schema.String,
  subject: Schema.String,
  upstream: Schema.String,
  upstreamGone: Schema.Boolean,
  onRemotes: Schema.Record(Schema.String, Schema.String),
  unpushed: Schema.Number,
  unique: Schema.Number,
  base: Schema.NullOr(Schema.String),
  baseSha: Schema.NullOr(Schema.String),
  mergeBase: Schema.NullOr(Schema.String),
  vsBases: Schema.Record(Schema.String, Divergence),
  ahead: Schema.Number,
  behind: Schema.Number,
  state: State,
  squashCommit: Schema.NullOr(Schema.String),
  containedIn: Schema.Array(Schema.String),
  commits: Schema.Array(Schema.String),
  diffstat: Schema.String,
  residual: Schema.String,
});
export type Branch = typeof Branch.Type;
export const Remote = Schema.Struct({
  lastFetchAt: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  url: Schema.String,
  pushurl: Schema.String,
  key: Schema.String,
  defaultBranch: Schema.String,
  fetchError: Schema.NullOr(Schema.String),
});
export const Clone = Schema.Struct({
  firstCommitAt: Schema.optional(Schema.String),
  lastCommitAt: Schema.optional(Schema.String),
  path: Schema.String,
  commonDir: Schema.String,
  name: Schema.String,
  key: Schema.String,
  roots: Schema.Array(Schema.String),
  remotes: Schema.Array(Remote),
  bases: Schema.Array(Schema.String),
  branches: Schema.Array(Branch),
  remoteBranches: Schema.Array(Branch),
  worktrees: Schema.Array(Worktree),
  stashes: Schema.Array(Schema.String),
  threads: Schema.Array(Thread),
  about: Schema.String,
  errors: Schema.Array(Schema.String),
});
export type Clone = typeof Clone.Type;
export const Snapshot = Schema.Struct({
  version: Schema.Literal(1),
  host: Schema.String,
  finished: Schema.String,
  repositories: Schema.Array(Clone),
  errors: Schema.Array(Schema.String),
});
export type Snapshot = typeof Snapshot.Type;
export const Action = Schema.Struct({
  id: Schema.String,
  host: Schema.String,
  repo: Schema.String,
  branch: Schema.String,
  sha: Schema.String,
  base: Schema.String,
  baseSha: Schema.String,
  state: State,
  archive: Schema.Boolean,
  remote: Schema.String,
});
export type Action = typeof Action.Type;
export const ActionResult = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    "planned",
    "running",
    "done",
    "skipped",
    "blocked",
    "failed",
  ]),
  reason: Schema.String,
  restore: Schema.String,
});
export type ActionResult = typeof ActionResult.Type;
export const ScanInput = Schema.Struct({
  hosts: Schema.Array(Schema.String),
  fetch: Schema.Boolean,
});
export const IdInput = Schema.Struct({ id: Schema.String });
export const ListInput = Schema.Struct({
  text: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  verdict: Schema.optional(Verdict),
  state: Schema.optional(State),
  stale: Schema.optional(Schema.Boolean),
  dirty: Schema.optional(Schema.Boolean),
  localOnly: Schema.optional(Schema.Boolean),
  sort: Schema.optional(Schema.Literals(["name", "date"])),
  page: Schema.optional(Schema.Number),
  pageSize: Schema.optional(Schema.Number),
});
export type ListInput = typeof ListInput.Type;
export function searchParams(input: unknown) {
  const p = Schema.decodeUnknownSync(ListInput)(input);
  return {
    ...p,
    text: p.text ?? "",
    sort: p.sort ?? "name",
    page: Math.max(1, Math.floor(p.page ?? 1)),
    pageSize: Math.max(1, Math.min(200, Math.floor(p.pageSize ?? 50))),
  };
}
export function stripDefaults(input: unknown) {
  const p = searchParams(input);
  return Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) =>
        !(
          (k === "text" && v === "") ||
          (k === "sort" && v === "name") ||
          (k === "page" && v === 1) ||
          (k === "pageSize" && v === 50)
        ),
    ),
  );
}

export const ChecksSummary = Schema.Struct({
  state: Schema.Literals(["success", "failure", "pending", "none"]),
  total: Schema.Number,
  failed: Schema.Number,
  pending: Schema.Number,
});
export type ChecksSummary = typeof ChecksSummary.Type;
export const PullRequest = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  forge: Schema.Literals(["github", "forgejo"]),
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  author: Schema.String,
  state: Schema.Literals(["open", "merged", "closed"]),
  draft: Schema.Boolean,
  head: Schema.String,
  headSha: Schema.String,
  base: Schema.String,
  branchId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  mergedAt: Schema.NullOr(Schema.String),
  checks: ChecksSummary,
  review: Schema.Literals([
    "approved",
    "changes_requested",
    "review_required",
    "none",
  ]),
  mergeable: Schema.NullOr(Schema.Boolean),
});
export type PullRequest = typeof PullRequest.Type;
export const PullRequestDetail = Schema.Struct({
  ...PullRequest.fields,
  body: Schema.String,
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      status: Schema.String,
      additions: Schema.Number,
      deletions: Schema.Number,
    }),
  ),
  diff: Schema.String,
  diffTruncated: Schema.Boolean,
  checkRuns: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      state: ChecksSummary.fields.state,
      url: Schema.NullOr(Schema.String),
    }),
  ),
  reviews: Schema.Array(
    Schema.Struct({
      author: Schema.String,
      state: Schema.String,
      body: Schema.String,
      at: Schema.String,
    }),
  ),
  comments: Schema.Array(
    Schema.Struct({
      author: Schema.String,
      body: Schema.String,
      at: Schema.String,
    }),
  ),
});
export type PullRequestDetail = typeof PullRequestDetail.Type;
export const PageInput = Schema.Struct({
  page: Schema.optional(Schema.Number),
  pageSize: Schema.optional(Schema.Number),
});
export const PullRequestListInput = Schema.Struct({
  ...PageInput.fields,
  repo: Schema.optional(Schema.String),
  state: Schema.optional(Schema.Literals(["open", "closed", "merged", "all"])),
  text: Schema.optional(Schema.String),
});
export const CreatePullRequestInput = Schema.Struct({
  branchId: Schema.String,
  cloneHost: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  title: Schema.String,
  body: Schema.String,
  draft: Schema.Boolean,
});
export const MergePullRequestInput = Schema.Struct({
  id: Schema.String,
  method: Schema.Literals(["merge", "squash", "rebase"]),
  deleteRemoteBranch: Schema.Boolean,
});
export const ActionKind = Schema.Literals([
  "delete-branch",
  "archive-and-delete",
  "switch-to-base",
  "prune-worktree",
  "fast-forward-base",
  "push-branch",
  "set-remote-url",
]);
export type ActionKind = typeof ActionKind.Type;
export const ActionTarget = Schema.Struct({
  host: Schema.String,
  repo: Schema.String,
  branch: Schema.optional(Schema.String),
  worktree: Schema.optional(Schema.String),
  remote: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
});
export type ActionTarget = typeof ActionTarget.Type;
export const PlannedAction = Schema.Struct({
  id: Schema.String,
  kind: ActionKind,
  target: ActionTarget,
  branchId: Schema.NullOr(Schema.String),
  repoKey: Schema.String,
  status: ActionResult.fields.status,
  reason: Schema.String,
  restore: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type PlannedAction = typeof PlannedAction.Type;
export const PlanActionsInput = Schema.Struct({
  kind: ActionKind,
  branchIds: Schema.optional(Schema.Array(Schema.String)),
  filter: Schema.optional(ListInput),
  targets: Schema.optional(Schema.Array(ActionTarget)),
});
export const ActionListInput = Schema.Struct({
  ...PageInput.fields,
  repo: Schema.optional(Schema.String),
  status: Schema.optional(ActionResult.fields.status),
});
export const AgentTask = Schema.Literals([
  "review-branch",
  "make-pr",
  "review-pr",
  "cleanup-repo",
  "describe-repo",
  "custom",
]);
export type AgentTask = typeof AgentTask.Type;
export const AgentInfo = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["acp", "cli"]),
  models: Schema.Array(Schema.String),
  defaultModel: Schema.String,
});
export type AgentInfo = typeof AgentInfo.Type;
export const AgentRunInput = Schema.Struct({
  agentId: Schema.String,
  model: Schema.optional(Schema.String),
  task: AgentTask,
  repo: Schema.String,
  host: Schema.optional(Schema.String),
  branchId: Schema.optional(Schema.String),
  pullRequestId: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
  worktree: Schema.Literals(["new", "existing", "none"]),
});
export type AgentRunInput = typeof AgentRunInput.Type;
export const AgentRun = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  model: Schema.String,
  task: AgentTask,
  repo: Schema.String,
  branchId: Schema.NullOr(Schema.String),
  pullRequestId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  status: Schema.Literals(["queued", "running", "done", "failed", "cancelled"]),
  summary: Schema.NullOr(Schema.String),
  costUsd: Schema.NullOr(Schema.Number),
  pullRequestUrl: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export type AgentRun = typeof AgentRun.Type;
export const AgentEvent = Schema.Struct({
  seq: Schema.Number,
  at: Schema.String,
  kind: Schema.Literals([
    "message",
    "thought",
    "tool",
    "permission",
    "status",
    "error",
  ]),
  text: Schema.String,
});
export type AgentEvent = typeof AgentEvent.Type;
export const AgentListInput = Schema.Struct({
  ...PageInput.fields,
  repo: Schema.optional(Schema.String),
  status: Schema.optional(AgentRun.fields.status),
});

export const About = Schema.Struct({
  summary: Schema.String,
  description: Schema.String,
  kind: Schema.String,
  generatedAt: Schema.String,
});
export type About = typeof About.Type;
export const JevClassification = Schema.Struct({
  recommendation: Schema.Literals([
    "delete",
    "archive",
    "keep",
    "finish_and_merge",
  ]),
  confidence: Schema.Number,
  flags: Schema.Array(Schema.String),
});
export type JevClassification = typeof JevClassification.Type;
