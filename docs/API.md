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

## Contract v4: Jev secrets and repository deletion

This backend upgrade preserves settings and inventory. Migrations add
`deleted_repositories`. Database files, existing WAL/SHM files and configured
backups are restricted to mode 0600.

### Settings

`Settings` gains `jev?: { apiKey?: string; apiKeyCommand?: string }` and
`archiveDir?: string`. Omission supports legacy settings; the settings view supplies
archiveDir's default `~/.local/share/repo-review/archives`, expanded per host.
`getSettings` / `get_settings` and settings updates return exported `SettingsView`:
existing settings fields, with `jev` replaced by
`{ apiKeySet: boolean; apiKeyCommand?: string; source: "settings" | "command" | "env" | "none" }`.
No key is returned. `updateSettings` / new MCP `update_settings` accepts
`jev?: { apiKey?: string | null; apiKeyCommand?: string | null }`:
strings set, null clears, omission preserves each stored field. Unknown view fields
are ignored, allowing read/edit-hosts/save without clearing credentials.
`update_scan_roots` also returns the redacted view.

Resolution: nonempty stored key → trimmed successful command output →
`TYPESAFE_API_KEY` → disabled. Commands run asynchronously on the server, with a
10-second timeout and 60-second cache. Failed/empty commands fall back to env.
Dashboard availability and classification resolve the same key. Command stderr is
discarded and classification errors are generic. There is no test_jev tool.

### Planning and application

`planRepositoryDeletion({ repositoryId, cloneIds?: string[] })` / MCP
`plan_repository_deletion` returns job `{id}` →
`{ actions: PlannedAction[], summary: RepositoryDeletionSummary }`.
Poll `getBackgroundJob` / `get_job` as usual. Omit cloneIds to select all inventoried
clones; IDs are host-and-path inventory clone IDs. Unknown/foreign IDs fail with
`ActionError`. Each clone gets one `delete-clone` action. Generic planActions rejects
this kind and directs callers to the dedicated planner.

```ts
type CloneDeletionSummary = {
  actionId: string; host: string; path: string; sizeBytes: number | null;
  linkedWorktrees: { path: string; branch: string | null; dirty: boolean; missing: boolean }[];
  branches: number;
  unpushedBranches: { name: string; ahead: number; integrated: boolean }[];
  dirtyFiles: number; stashes: number;
  ignoredKept: { files: number; bytes: number };
  ignoredSkipped: { files: number; bytes: number };
  activeThreads: { id: string; title: string }[];
  blockers: string[];
};
type RepositoryDeletionSummary = {
  repositoryId: string; name: string; clones: CloneDeletionSummary[];
  remainingClones: number; purgesRepository: boolean; archiveDir: string;
};
```

Schemas/types are exported from domain/model.ts. Size uses du, including external
linked worktrees without double-counting nested paths. Dirty count deduplicates
staged/modified/untracked paths per checkout. Unpushed branches are ahead of their
upstream, or contain commits on no remote and are not integrated into the base.

`applyActions({ ids: string[], confirm?: string })` / MCP `apply_actions` returns
job `{id}` → `PlannedAction[]`. Every requested delete-clone action must have its
repository display name equal confirm. Otherwise the **entire submission** fails
with typed `DeletionConfirmationError` before starting a job or changing actions.
Other invalid targets/plans use `ActionError`; host guards yield persisted `blocked`
actions with a displayable reason.

Planning/application run on the clone host through the existing local/SSH worker.
Resolved clone paths must be strictly inside current host roots, never a root,
home or `/`, equal Git's toplevel, and own the common Git directory. Linked
worktrees must be strictly within host roots or the agent worktree directory.
Archives must be outside every checkout. Fingerprints include all refs, stash
list, porcelain status for all checkouts and the worktree list. Changes block
application, including a second check after archiving. Queued/running agent runs,
active T3 threads and process cwd inside any checkout block removal; unavailable
T3/process verification also blocks it.

### Mandatory archive and restore

```text
<archiveDir>/<sanitized repo name>/<UTC timestamp>-<sanitized host>-<action id>/
  repo.bundle
  info.json
  worktrees/0.tar.gz
  worktrees/0.staged.patch
  worktrees/0.unstaged.patch
  worktrees/1.tar.gz ...
```

The action suffix prevents same-host clone collisions. Checkout indices/paths are
recorded in info.json. Nonempty binary patches are saved per checkout. Tar archives
contain existing staged/modified/untracked files and ignored files ≤5 MiB outside
`node_modules`, `.venv`, `venv`, `target`, `dist`, `build`, `.next`, `.nuxt`,
`.turbo`, `.cache`, `__pycache__`, `.gradle`, `Pods`, `DerivedData`, `.direnv`.
Deleted tracked files are recoverable from patches. Skipped ignored files are lost;
info.json lists up to 2000 skipped paths, repository identity, remotes, branch SHAs,
linked worktrees and timestamps. Git bundle --all includes refs/stash and is verified;
`stashes.bundle` carries every stash entry as `refs/stashes/<n>` (0 = newest).
Ref-less repositories skip the bundle and record noRefs. Every produced archive
file must exist and be nonempty before any removal. Archive failure leaves disk
checkouts intact. External linked worktrees are recursively removed before the
clone; forge-side repositories are never modified.

Action restore text describes cloning repo.bundle, explicitly fetching refs/stash,
recreating linked worktrees from info.json, extracting each tar and applying staged
patches with git apply --index and unstaged patches with git apply. Ref-less repos
use git init instead of clone.

### Purge and tombstones

After worker success, a SQLite transaction removes the clone and its cascading
branch/worktree/file/remote/stash projections and clone history. Partial deletion
keeps repository data. Final deletion also removes repositories, branches, history,
PRs and PR commits, commit-list caches, landings/provenance, descriptions,
classifications, sync watermarks, agent runs/events. Agent worktrees are Git linked
worktrees; no separate record table exists. In-memory forge ETags are invalidated.
Forge budgets and action audit records remain.

`listDeletedRepositories()` / MCP `list_deleted_repositories` takes no input and
returns `{ id, name, deletedAt, clones: { host, path, archivePath }[] }[]`.
Partial deletion archives accumulate in the tombstone. Tombstones never suppress
rediscovery. Purge emits coalesced SSE invalidations for inventory, pull-requests,
actions and repositories.

### Forgejo deleted heads

Recovery prefers head.ref, head_branch, head.label (without owner prefix), merge
commit message, then a unique branch_history name matching the head SHA. Ambiguous
history preserves refs/pull/N/head. When metadata/history cannot recover the name,
sync/detail requests the merge commit using the read-only Git commit endpoint.
A sanitized fixture covers recovery; live verification needs the operator's
configured endpoint and credentials.

## Contract v4.1: ownership and repository mute

`Forge` adds `owners?: string[]`: account/org logins considered owned on that
forge, matched case-insensitively. Omitted or empty owners preserves the existing
all-owned behavior. Repository list items and details add:

```ts
owner: string | null; // owner component of normalized host/owner/name; null for local keys
mine: boolean; // owner matches forge owners, or local/unrecognized forge, or owners absent/empty
muted: boolean;
```

Every PR summary/detail adds `mine: boolean`, computed from its stored `author`
login and the current forge owners. It never inherits repository ownership.
Changing owners takes effect on reads immediately, with no rescan or resync.

`setRepositoryMuted({ repositoryId: string, muted: boolean })` (POST) and MCP
`set_repository_muted` return `{ repositoryId: string, muted: boolean }`.
`repositoryId` is the exact normalized key returned by repository lists; an unknown
key raises `NotFound`. Repeated calls are idempotent. Mute keys persist as a string
array in the independent settings row `muted-repositories`; scan replacement and
main settings edits cannot overwrite it. No schema migration is needed.

These inputs add `includeMuted?: boolean` (default false) and `mine?: boolean`:
`listRepositories`, `searchBranches`, `listWorktrees`, `listPullRequests`,
`listLandings`, and `listBranchHistory`. Existing required inputs (including
`listLandings.repo`) remain required. `mine: true` selects owned repositories for
inventory/history/landings, but **owned PR authors only** for PR lists;
`mine: false` selects the complement. Omitted `mine` imposes no ownership filter.
Mute and ownership predicates run in SQL before pagination, so totals include only
matching items. `getRepository`, `getBranch`, `getPullRequest`, and commit provenance
lookups retain direct access to muted repositories.

`getDashboard` and MCP `get_dashboard` exclude muted repositories from repository,
clone, branch/verdict, worktree and open PR counts, and from running agent counts.
They add `mutedRepositories: number` (distinct collected muted repository keys).
Scans, scan status, global forge budgets and feature flags remain global.
Ownership alone does not hide inventory: callers opt in with `mine`.

All bulk PR sync paths (including refresh, scheduled scans and scan-triggered sync)
skip muted keys. An explicit `repo` in `syncPullRequests`/`sync_pull_requests` or
refresh overrides mute. Muting does not remove cached PRs or inventory. Scans still
collect clones and update provenance. Cleanup planning (`planCleanup`,
`plan_cleanup`, and filter-based `planActions`) defaults `includeMuted` to true;
explicit false excludes muted repositories. Worker safety checks are unchanged.

MCP adds `get_dashboard` and `set_repository_muted`; existing tool names remain
stable. Every tool now describes its effect, target ids, background polling and
mutation behavior, and every input property (including nested targets/filters)
has a JSON Schema description. `start_scan` returns a scan id for `get_scan`;
`start_agent_run` returns a run id for `get_agent_run`; sync, refresh, planning and
apply tools return job ids for `get_job`.

Upgrade: existing databases retain settings and cached data; mute defaults to off
and owners defaults to all-owned. No production data mutation, backfill or inventory
rescan is required to enable these read filters. Author logins were already cached.
