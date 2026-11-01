# Backend contract

Import server functions from `src/server/functions.ts`, and call e.g.
`await listPullRequests({ data: {} })`. Domain Schemas and types are exported from
`src/domain/model.ts`. Server functions and MCP share the application runtime.

## Operational constraints

- Inventory lists group clone snapshots in memory; PR, action and run filters and
  pagination execute in SQL. Repository storage also maintains relational inventory
  projections with foreign keys alongside the versioned clone snapshots.
- `prune-worktree` refuses to prune when another missing registration would also
  be affected by Git's global prune operation. Resolve each missing registration
  before retrying. All actions use worker-side checks at both plan and apply time.
- `planCleanup` remains a compatibility alias for planning `delete-branch` actions.
  `getBackgroundJob({id})` retrieves long operation results; MCP calls it `get_job`.

## Upgrade and operation

Migrations preserve settings from the old `records` table. Inventories, cached PRs,
old action plans, jobs and agent history are discarded: run a fresh scan after
upgrading. Old action plans cannot be applied against the new worker.
`BACKUP_DIR` configures daily SQLite `VACUUM INTO` backups, retaining fourteen
copies. Daily scan and backup claims persist in settings across restarts. Schedule
checks run every thirty seconds using the server's local clock; the daily scan
runs during the configured minute. Interrupted scans, jobs, runs and actions are
failed with a restart reason. Shutdown cancels agent process groups and drains
host/job work before closing SQLite.

`GET /api/events` provides SSE invalidation hints and heartbeat comments. A
client should refetch after reconnecting; events are not a replay log.
Optional `MCP_TOKEN` protects `/mcp`. Forge token commands run only on the server;
tokens are never included in API results.

List pages are one-based, default to page 1 / 50 items, and clamp sizes to 1–200.
`ListInput` keeps optional text, host, repo, verdict, state, stale, dirty, localOnly,
sort (`name` or `date`), page and pageSize. Existing repository, branch, worktree,
scan, settings, description and classification functions retain their names.
Repository IDs are normalized remote keys; branch IDs are `${repo}#${branch}`.
Preserve IDs verbatim and URL-encode them in routes.

MCP tools include `list_hosts`, `start_scan`, `get_scan`, `list_repositories`,
`get_repository`, `search_branches`, `get_branch`, `list_worktrees`,
`list_pull_requests`, `get_pull_request`, `refresh_pull_requests`,
`create_pull_request`, `merge_pull_request`, `close_pull_request`,
`comment_pull_request`, `plan_actions`, `apply_actions`, `list_actions`, `get_job`,
`plan_cleanup`, `delete_branch` (plan only), `list_agents`, `start_agent_run`,
`get_agent_run`, `list_agent_runs`, `cancel_agent_run`, `get_settings`,
`update_scan_roots`. Planning, applying and refreshing return job IDs.

## Contract v2 (target, agreed before the UI build)

The UI is built against this section; the backend implements it in place of the provisional parts above.
Existing list/detail/scan/settings functions keep their names and shapes, except where stated here.
All types below are Effect Schemas exported from `src/domain/model.ts` (or a sibling domain module).

### Pull requests (replaces the `{json}` adapters and `forgeOperation`)

```ts
type ChecksSummary = {
  state: "success" | "failure" | "pending" | "none";
  total: number;
  failed: number;
  pending: number;
};
type PullRequest = {
  id: string; // `${repositoryKey}!${number}`
  repo: string; // repository key
  forge: "github" | "forgejo";
  number: number;
  title: string;
  url: string;
  author: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  head: string;
  headSha: string;
  base: string;
  branchId: string | null; // grouped branch id when the head branch is known locally
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  checks: ChecksSummary;
  review: "approved" | "changes_requested" | "review_required" | "none";
  mergeable: boolean | null;
};
type PullRequestDetail = PullRequest & {
  body: string;
  files: {
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }[];
  diff: string;
  diffTruncated: boolean; // capped at 500 kB
  checkRuns: {
    name: string;
    state: ChecksSummary["state"];
    url: string | null;
  }[];
  reviews: { author: string; state: string; body: string; at: string }[];
  comments: { author: string; body: string; at: string }[];
};
```

| Function              | Input (`data`)                                                                                 | Result                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `listPullRequests`    | `{ repo?, state?: "open"\|"merged"\|"closed"\|"all" (default "open"), text?, page, pageSize }` | page of `PullRequest` (all repositories when `repo` is omitted) |
| `getPullRequest`      | `{ id }`                                                                                       | `PullRequestDetail \| null`                                     |
| `refreshPullRequests` | `{ repo? }`                                                                                    | job `{id}`                                                      |
| `createPullRequest`   | `{ branchId, cloneHost?, base?, title, body, draft }`                                          | `PullRequest` (pushes the branch to its remote first if needed) |
| `mergePullRequest`    | `{ id, method: "merge"\|"squash"\|"rebase", deleteRemoteBranch: boolean }`                     | `PullRequest`                                                   |
| `closePullRequest`    | `{ id }`                                                                                       | `PullRequest`                                                   |
| `commentPullRequest`  | `{ id, body }`                                                                                 | `{ ok: true }`                                                  |

Errors are typed (`ForgeUnavailable`, `ForgeRejected` with the forge message, `NotFound`) and surface as a
message the UI can show.

### Actions (replaces `planCleanup` / `applyActions` input shapes; ids stay the same concept)

```ts
type ActionKind =
  | "delete-branch"
  | "archive-and-delete"
  | "switch-to-base"
  | "prune-worktree"
  | "fast-forward-base"
  | "push-branch"
  | "set-remote-url";
type ActionTarget = {
  host: string;
  repo: string /* clone path */;
  branch?: string;
  worktree?: string;
  remote?: string;
  url?: string;
};
type PlannedAction = {
  id: string;
  kind: ActionKind;
  target: ActionTarget;
  branchId: string | null;
  repoKey: string;
  status: "planned" | "skipped" | "blocked" | "running" | "done" | "failed";
  reason: string;
  restore: string | null;
  createdAt: string;
  finishedAt: string | null;
};
```

| Function       | Input                                                                          | Result                                 |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| `planActions`  | `{ kind, branchIds?: string[], filter?: ListInput, targets?: ActionTarget[] }` | job `{id}` → `PlannedAction[]`         |
| `applyActions` | `{ ids: string[] }`                                                            | job `{id}` → `PlannedAction[]`         |
| `listActions`  | `{ status?, repo?, page, pageSize }`                                           | page of `PlannedAction` (newest first) |

`planActions({ kind: "delete-branch", filter })` is the "clean up everything deletable" path (verdict `delete`).

### Agents

```ts
type AgentInfo = {
  id: string;
  label: string;
  kind: "acp" | "cli";
  models: string[];
  defaultModel: string;
};
type AgentTask =
  | "review-branch"
  | "make-pr"
  | "review-pr"
  | "cleanup-repo"
  | "describe-repo"
  | "custom";
type AgentRunInput = {
  agentId: string;
  model?: string;
  task: AgentTask;
  repo: string /* key */;
  host?: string;
  branchId?: string;
  pullRequestId?: string;
  note?: string;
  worktree: "new" | "existing" | "none";
};
type AgentRun = {
  id: string;
  agentId: string;
  model: string;
  task: AgentTask;
  repo: string;
  branchId: string | null;
  pullRequestId: string | null;
  cwd: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  summary: string | null;
  costUsd: number | null;
  pullRequestUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
};
type AgentEvent = {
  seq: number;
  at: string;
  kind: "message" | "thought" | "tool" | "permission" | "status" | "error";
  text: string;
};
```

| Function         | Input                                | Result                                                            |
| ---------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `listAgents`     | none                                 | `AgentInfo[]`                                                     |
| `startAgentRun`  | `AgentRunInput`                      | `{ id }` (prompt built server-side from the task template + note) |
| `getAgentRun`    | `{ id, cursor?: number }`            | `{ run: AgentRun, events: AgentEvent[], cursor: number } \| null` |
| `listAgentRuns`  | `{ status?, repo?, page, pageSize }` | page of `AgentRun`                                                |
| `cancelAgentRun` | `{ id }`                             | `AgentRun`                                                        |

### Descriptions and classification on read models

`Repository` list items and details gain `about: { summary, description, kind, generatedAt } | null`.
Grouped branches gain `jev: { recommendation: "delete"|"archive"|"keep"|"finish_and_merge"; confidence: number;
flags: string[] } | null` (null when Jev is disabled or not run). `getDashboard` adds `openPullRequests`,
`runningAgentRuns`, `lastScan`, and `jevEnabled`.

### Live updates

`GET /api/events` (SSE) emits `{ type: "scan" | "job" | "agent-run" | "inventory", id }` when something changes,
so the UI can invalidate queries; polling every 2 s remains a valid fallback.
