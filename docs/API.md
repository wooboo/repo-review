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

## Contract v3 (target): pull-request provenance and fixes

Problem: after a squash merge the base only has one new commit, and nothing in git says which branch it came
from. Patch-id matching fails when the PR got conflict resolutions, base merges or review fixes, and "PR merged
with the same head" fails when the local branch is one commit behind or ahead of the PR's final head. v3 makes
the app remember pull requests permanently and link branches ↔ PRs ↔ base commits.

### Data the backend keeps

- **Every PR of every configured repository, all states**, synced incrementally (by `updated_at`) and kept
  after the forge branch is deleted: number, title, head ref, head SHA, base, state, `mergeCommitSha`,
  merge method (`merge`/`squash`/`rebase`/`unknown`, inferred from the merge commit's parents and whether the
  PR head is its ancestor), merged at, and the **list of all PR commit SHAs** (GitHub `GET /pulls/{n}/commits`,
  Forgejo `GET /pulls/{n}/commits`). Stored in real columns/tables (`pull_requests` columns + `pull_request_commits
  (pr_id, sha, position)`), not only JSON.
- **Branch history** (`branch_history`): every (host, clone, branch, sha) seen by scans with first/last seen and
  `goneAt`, so deleted branches remain explainable.
- **Base commit provenance**: for base commits of the last 180 days, the PR that produced them, from
  `mergeCommitSha`, else from the commit message (`(#N)` suffix, `Merge pull request '…' (#N) from <branch>`,
  `Merge pull request #N from owner/branch`, `Merge branch '<branch>'`), else from `Source-Branch:`/`Source-PR:`
  trailers, else patch-id (existing squash detection).

### Linking rules (per clone, before the existing state rules decide "unmerged")

1. The branch tip SHA is any commit of a **merged** PR (or its head SHA) → `landedVia = { pr, extraCommits: 0 }`,
   state `pr-merged` (counts as integrated).
2. Some PR commit is an ancestor of the tip and that PR is merged → `landedVia` with `extraCommits` = commits on
   the branch after the newest such PR commit; verdict `pr-merged-changed` shows only those commits for review.
3. Same rules for remote branches and for `branch_history` entries.

### Read-model changes

```ts
type LandedVia = { pullRequestId: string; number: number; url: string; method: "merge" | "squash" | "rebase" | "unknown";
  mergeCommitSha: string | null; matchedSha: string; extraCommits: number; extraCommitShas: string[] }
// grouped branch: per-clone `landedVia: LandedVia | null`, and branch-level `landedVia` when all clones agree
// PullRequest: + mergeCommitSha: string | null; mergeMethod: LandedVia["method"] | null; commitCount: number
// PullRequestDetail: + commits: { sha: string; subject: string; author: string; at: string }[]
type Landing = { sha: string; subject: string; author: string; at: string; base: string;
  pullRequestId: string | null; number: number | null; sourceBranch: string | null;
  method: LandedVia["method"] | "direct"; via: "merge-commit-sha" | "message" | "trailer" | "patch-id" | "none";
  branchIds: string[] /* local branches (live or gone) that landed in this commit */ }
type BranchHistoryItem = { host: string; repo: string; clonePath: string; branch: string; sha: string;
  firstSeen: string; lastSeen: string; goneAt: string | null; landedVia: LandedVia | null }
```

| Function | Input | Result |
|---|---|---|
| `listLandings` | `{ repo, base?, since?, page, pageSize }` | page of `Landing` (newest first) |
| `getCommitProvenance` | `{ repo, sha }` | `Landing \| null` |
| `listBranchHistory` | `{ repo?, gone?: boolean, page, pageSize }` | page of `BranchHistoryItem` |
| `syncPullRequests` | `{ repo? }` | job `{id}` (incremental; full when `repo` given and `full: true`) |

`mergePullRequest` with `method: "squash"` (and `"merge"`) appends trailers to the commit message:
`Source-Branch: <head ref>`, `Source-Head: <head sha>`, `Source-PR: <url>`, so provenance survives without the forge.
MCP gains `list_landings`, `get_commit_provenance`, `list_branch_history`, `sync_pull_requests`.

### Fixes required in v3

- Forge tokens: resolve token commands asynchronously (`Bun.spawn`), cache per forge for 10 minutes; no
  `spawnSync` on the request path. PR lists are served from the DB; forge fetches happen only in sync jobs.
- Read models built once per request; no per-branch scans of all PR rows (index by repo + head ref + sha).
- A missing worktree directory is `missing`, not `dirty`; dashboard "dirty worktrees" counts only real changes.
- Queried fields are real columns: branches (verdict, state, last commit at, stale, dirty, local-only, repo,
  name), pull_requests (repo, number, state, head ref, head sha, merge commit sha, base, updated at, merged at).

### v3 implementation and upgrade

Contract differences: none. `syncPullRequests` accepts optional `full: boolean`; a full
sync requires `repo`. `refreshPullRequests` remains the incremental compatibility
alias. Both server functions return jobs, and scans sync the configured repositories
after collecting each host. PR list reads use only SQLite.

The v3 migration preserves existing PR rows and settings. Scan again to populate
branch projections, history, and the 180-day landing cache, then run a full PR sync
to backfill commit lists. A failed sync does not advance its `updated_at` watermark;
retries include records at the watermark. Branch disappearance never removes PRs.
Landing and history reads use the last completed scan/sync's persisted evidence.
History is keyed by host, clone path, branch name and observed SHA; moving a branch
marks the previous observed SHA gone, and seeing that tuple again clears `goneAt`.

Cleanup obtains fresh PR state and commit membership from the store at both plan
and apply time. The worker independently verifies the captured branch tip, base,
worktree and activity checks before accepting that evidence. Merge methods remain
`unknown` when neither clone objects nor forge metadata establish the ancestry.

## Contract v3.1: bounded sync and inventory corrections

GitHub sync uses GraphQL PR metadata pages ordered by `UPDATED_AT DESC`. Pages stop
at the persisted watermark (inclusive, so equal timestamps are retried). Commit
connections are fetched in batches of ten PRs, paged in chunks of 100 (GitHub's
maximum connection page size), and cached persistently by PR id **and head SHA**.
Only open/merged PRs are eligible. Heads from another repository are skipped unless
a local branch matches the head ref. Forgejo uses conditional REST requests with
ETags; the conditional response cache lives for the application lifetime. Closed PR
metadata is retained even when no commit list is fetched. Merge methods are inferred
from local objects during sync; unavailable ancestry remains `unknown`.

Only repositories with a configured forge and a collected clone are synced. All
sync entry points share one queue; forge requests also run serially (global
concurrency one). Each sync has a hard ceiling of 280 HTTP requests, across all
repositories. No PR mutations are performed by sync.

Forge configuration gains `requestReserve?: number` (nonnegative integer, default
1000 for GitHub and 0 for Forgejo). GitHub sync first checks both REST `core` and
GraphQL budgets. Response rate-limit headers update persisted budgets, and requests
stop before crossing the reserve (GraphQL reserves ten points per bounded query).
`Retry-After`, 429 responses and primary/secondary rate-limit responses pause work.

`getDashboard` adds:

```ts
missingWorktrees: number;
forgeBudgets: {
  host: string;
  resource: "core" | "graphql" | string;
  remaining: number;
  resetAt: string;
  reserve: number;
  pausedUntil?: string;
}[];
```

Sync job results are `{ pullRequests, forgeBudgets }`. Rate-limited jobs have
`status: "paused"`, `errorType: "ForgeRateLimited"`, a displayable `error`,
`retryAt` and `result: { forgeBudgets }`. The scheduler resumes the same job after
`retryAt`, including after restart, with its original repo/full input. The sync
watermark advances only after the repository completes; previously completed
commit lists remain cached on retry. Scan-triggered pauses create the same durable
retry jobs. A 280-request safety pause retries after one hour.

`/api/events` invalidations are coalesced by type and id, at most once per second.
A sync emits `pull-requests` and `inventory` for each affected repo when its batch
finishes, including partial failure; row writes do not emit one event per PR.

Worktrees expose `missing: boolean` (derived from `!exists` for legacy snapshots).
A missing directory is never dirty. Branch verdicts ignore its old dirty flag;
`missingWorktrees` counts it separately. Planning deletion adds guarded
`prune-worktree` dependencies for missing registrations. The deletion can only be
applied once its prunes complete, and the worker still refuses a missing registration
at apply time. Prune retains all existing index, lock, activity and global-prune
checks. Clone ids include host and absolute clone path. Automatic T3 roots and
threads belong only to the first enabled local host on that machine; SSH collectors
read their own host's T3 database.

Branch `commits` now contain `{ sha, subject, author, at }` objects from the collector
(legacy string entries remain accepted). A `pr-merged-changed` clone retains these
objects when selecting extra commits. Base branches have no `landedVia` and are
excluded from landing `branchIds`.

Additional server/MCP list inputs (applied **before** paging):

| Function | Added input |
|---|---|
| `searchBranches` | `verdicts?: Verdict[]`, `jev?: "delete"\|"archive"\|"keep"\|"finish_and_merge"` |
| `listPullRequests` | `checks?: "success"\|"failure"\|"pending"\|"none"` |
| `listWorktrees` | `missing?: boolean` (`dirty` excludes missing directories) |
| `listBranchHistory` | `text?: string` (case-insensitive history search) |

The singular branch `verdict` remains supported; when both are supplied their
constraints intersect. UI callers send these filters directly and retain server
pagination totals.

Rate-limit behavior follows [GitHub GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)
and [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
