# Backend contract

Import server functions from `src/server/functions.ts`; call them as
`await listRepositories({ data: {} })`. Functions use Effect Schema Standard Schema
validators and the shared application runtime. Types are exported from
`src/domain/model.ts`, `src/server/application.ts`, and `src/server/agents.ts`.
The placeholder page demonstrates a server-side loader.

## List inputs and identifiers

`ListInput`: optional `text`, `host`, `repo`, `verdict`, `state`, `stale`, `dirty`,
`localOnly`, `sort: "name" | "date"`, `page`, `pageSize`. Defaults: empty text,
name sort, page 1, page size 50 (clamped to 1–200). Pages are one-based. Lists return
`{ items, total, page, pageSize }`. Branch filters combine with AND. `host` matches
any clone of a grouped branch. `state` matches any clone. `stale` requires all
clones to exceed the configured age. `dirty` and `localOnly` match any clone.

Use `searchParams` to validate decoded URL state and `stripDefaults` before writing
it to the URL. Convert numeric and boolean URL strings before validation.

Repository ids are normalized remote keys. Branch ids are `${repositoryKey}#${branchName}`.
Clone paths and worktree paths are host-specific. Preserve returned ids verbatim;
URL-encode them when constructing routes. Details return `null` for an absent
branch/job/run; repository details return an empty clone/branch collection.

## Functions

| Function             | Input (`data`)                      | Result                                                                         |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `getDashboard`       | none                                | repositories, clones, branches, verdict counts, dirty worktrees, running scans |
| `listRepositories`   | ListInput                           | page of id/key/name/clone count/branch count                                   |
| `getRepository`      | `{id}`                              | key, complete clones, grouped branches                                         |
| `searchBranches`     | ListInput                           | page of grouped branches; verdict/flags and per-clone analysis                 |
| `getBranch`          | `{id}`                              | grouped branch or null                                                         |
| `listWorktrees`      | ListInput                           | page with status counts, up to 300 changed files and mtimes                    |
| `startScan`          | `{hosts: string[], fetch: boolean}` | `{id}`; empty hosts means every enabled host                                   |
| `getScan`            | `{id}`                              | persisted status/events/errors/start/finish or null                            |
| `listScans`          | none                                | scan history                                                                   |
| `planCleanup`        | ListInput                           | background job `{id}`                                                          |
| `applyActions`       | `{ids: string[]}`                   | background job `{id}`; only planned ids accepted                               |
| `listActions`        | none                                | persisted action inputs, results, restore commands                             |
| `getBackgroundJob`   | `{id}`                              | status/result/error or null                                                    |
| `startAgentRun`      | AgentRunInput                       | `{id}`                                                                         |
| `getAgentRun`        | `{id, cursor?: number}`             | run, events since cursor, next cursor; or null                                 |
| `listAgentRuns`      | none                                | complete persisted runs                                                        |
| `cancelAgentRun`     | `{id}`                              | cancelled status; run must be active in this process                           |
| `getSettings`        | none                                | Settings                                                                       |
| `updateSettings`     | Settings                            | validated Settings (full replacement)                                          |
| `listPullRequests`   | `{id: repositoryKey}`               | `{json}`: JSON array of upstream PR objects; refreshes cache                   |
| `getPullRequest`     | `{repo, number}`                    | `{json}`: pull/diff/files/reviews                                              |
| `forgeOperation`     | `{repo, operation, json}`           | `{json}`: upstream response                                                    |
| `describeRepository` | `{id: repositoryKey}`               | background job `{id}`                                                          |
| `classifyBranch`     | `{id: branchId}`                    | background job `{id}` (disabled result without API key)                        |

Forge operations: `create`, `merge`, `close`, `comment`, `metadata`, `search`,
`create-repository`. `json` is the serialized upstream operation payload. No token
is returned. Forge responses deliberately retain upstream field names; deserialize
the `json` string in the UI. This adapter is provisional, pending dedicated
validated per-operation schemas.

`AgentRunInput`: agent id, local repo path, branch, prompt, optional model,
existingWorktree, task (`review-branch`, `make-pr`, `review-pr`, `cleanup-repo`,
`custom`). The current runner uses the supplied prompt directly; task templates
are not yet supplied. CLI args support `{model}` and `{prompt}` substitutions;
without a prompt placeholder the prompt is appended as one argument. ACP uses
SDK 2.2's stable v1 API and `session/set_config_option` for model selection.
Models must appear in the configured agent's model list. A fresh branch/worktree
is created unless an existing registered worktree is requested. Runs are local.

## Jobs and safety

Poll scans with `getScan` and agent runs with `getAgentRun` about once per second.
Scans progress queued → running → done/failed; events contain repository progress
and per-host completion. A successful host replaces its current inventory in one
transaction; a failed host retains its previous inventory. Hosts queue independently.

Poll action/description/classification jobs with `getBackgroundJob`.
These jobs return running → done/failed, with the result or error in that record.
A completed cleanup-plan job contains action results with ids. Display every
result and reason before submitting only selected `planned` ids to `applyActions`.
Individual action statuses: planned, running, done, skipped, blocked, failed.
Archive deletion must be planned explicitly through MCP `delete_branch` with
`archive: true`; apply the returned planned id through `applyActions`.
The worker rechecks SHAs, bases, integration, worktrees, processes, and T3 activity.
A blocked safety check must be shown to the user, never bypassed by the UI.

Scans and run events currently include all progress in the persisted job/run
record. There is no SSE or separate event table yet. Scans in progress at restart
are marked failed. Other interrupted jobs/runs still need restart recovery.

## MCP

`/mcp` is stateless Streamable HTTP using the official SDK. Set `MCP_TOKEN` for
Bearer authentication. Otherwise the endpoint is available without authentication,
as required by the product spec. Tool input JSON Schemas derive from Effect Schema.

Tools: `list_hosts`, `start_scan`, `get_scan`, `list_repositories`, `get_repository`,
`search_branches`, `get_branch`, `list_worktrees`, `list_pull_requests`,
`get_pull_request`, `plan_cleanup`, `apply_actions`, `delete_branch`,
`create_pull_request`, `merge_pull_request`, `close_pull_request`, `start_agent_run`,
`get_agent_run`, `list_agent_runs`, `get_settings`, `update_scan_roots`.

MCP cleanup tools currently return their results directly rather than generic job
ids. `delete_branch` only plans; it never applies. `update_scan_roots` updates an
existing host; add hosts with the full settings server function. MCP results use
one JSON text content block and failures set `isError`.

## Remaining implementation work

This foundation does not complete all of SPEC.md. See the implementation-status
appendix there before building workflows that assume the remaining features.

## Contract v2 (target, agreed before the UI build)

The UI is built against this section; the backend implements it in place of the provisional parts above.
Existing list/detail/scan/settings functions keep their names and shapes, except where stated here.
All types below are Effect Schemas exported from `src/domain/model.ts` (or a sibling domain module).

### Pull requests (replaces the `{json}` adapters and `forgeOperation`)

```ts
type ChecksSummary = { state: "success" | "failure" | "pending" | "none"; total: number; failed: number; pending: number }
type PullRequest = {
  id: string                     // `${repositoryKey}!${number}`
  repo: string                   // repository key
  forge: "github" | "forgejo"
  number: number; title: string; url: string; author: string
  state: "open" | "merged" | "closed"; draft: boolean
  head: string; headSha: string; base: string
  branchId: string | null        // grouped branch id when the head branch is known locally
  createdAt: string; updatedAt: string; mergedAt: string | null
  checks: ChecksSummary
  review: "approved" | "changes_requested" | "review_required" | "none"
  mergeable: boolean | null
}
type PullRequestDetail = PullRequest & {
  body: string
  files: { path: string; status: string; additions: number; deletions: number }[]
  diff: string; diffTruncated: boolean                  // capped at 500 kB
  checkRuns: { name: string; state: ChecksSummary["state"]; url: string | null }[]
  reviews: { author: string; state: string; body: string; at: string }[]
  comments: { author: string; body: string; at: string }[]
}
```

| Function | Input (`data`) | Result |
|---|---|---|
| `listPullRequests` | `{ repo?, state?: "open"\|"merged"\|"closed"\|"all" (default "open"), text?, page, pageSize }` | page of `PullRequest` (all repositories when `repo` is omitted) |
| `getPullRequest` | `{ id }` | `PullRequestDetail \| null` |
| `refreshPullRequests` | `{ repo? }` | job `{id}` |
| `createPullRequest` | `{ branchId, cloneHost?, base?, title, body, draft }` | `PullRequest` (pushes the branch to its remote first if needed) |
| `mergePullRequest` | `{ id, method: "merge"\|"squash"\|"rebase", deleteRemoteBranch: boolean }` | `PullRequest` |
| `closePullRequest` | `{ id }` | `PullRequest` |
| `commentPullRequest` | `{ id, body }` | `{ ok: true }` |

Errors are typed (`ForgeUnavailable`, `ForgeRejected` with the forge message, `NotFound`) and surface as a
message the UI can show.

### Actions (replaces `planCleanup` / `applyActions` input shapes; ids stay the same concept)

```ts
type ActionKind = "delete-branch" | "archive-and-delete" | "switch-to-base" | "prune-worktree" | "fast-forward-base" | "push-branch" | "set-remote-url"
type ActionTarget = { host: string; repo: string /* clone path */; branch?: string; worktree?: string; remote?: string; url?: string }
type PlannedAction = { id: string; kind: ActionKind; target: ActionTarget; branchId: string | null; repoKey: string;
  status: "planned" | "skipped" | "blocked" | "running" | "done" | "failed"; reason: string; restore: string | null;
  createdAt: string; finishedAt: string | null }
```

| Function | Input | Result |
|---|---|---|
| `planActions` | `{ kind, branchIds?: string[], filter?: ListInput, targets?: ActionTarget[] }` | job `{id}` → `PlannedAction[]` |
| `applyActions` | `{ ids: string[] }` | job `{id}` → `PlannedAction[]` |
| `listActions` | `{ status?, repo?, page, pageSize }` | page of `PlannedAction` (newest first) |

`planActions({ kind: "delete-branch", filter })` is the "clean up everything deletable" path (verdict `delete`).

### Agents

```ts
type AgentInfo = { id: string; label: string; kind: "acp" | "cli"; models: string[]; defaultModel: string }
type AgentTask = "review-branch" | "make-pr" | "review-pr" | "cleanup-repo" | "describe-repo" | "custom"
type AgentRunInput = { agentId: string; model?: string; task: AgentTask; repo: string /* key */; host?: string;
  branchId?: string; pullRequestId?: string; note?: string; worktree: "new" | "existing" | "none" }
type AgentRun = { id: string; agentId: string; model: string; task: AgentTask; repo: string; branchId: string | null;
  pullRequestId: string | null; cwd: string; status: "queued" | "running" | "done" | "failed" | "cancelled";
  summary: string | null; costUsd: number | null; pullRequestUrl: string | null; startedAt: string; finishedAt: string | null }
type AgentEvent = { seq: number; at: string; kind: "message" | "thought" | "tool" | "permission" | "status" | "error"; text: string }
```

| Function | Input | Result |
|---|---|---|
| `listAgents` | none | `AgentInfo[]` |
| `startAgentRun` | `AgentRunInput` | `{ id }` (prompt built server-side from the task template + note) |
| `getAgentRun` | `{ id, cursor?: number }` | `{ run: AgentRun, events: AgentEvent[], cursor: number } \| null` |
| `listAgentRuns` | `{ status?, repo?, page, pageSize }` | page of `AgentRun` |
| `cancelAgentRun` | `{ id }` | `AgentRun` |

### Descriptions and classification on read models

`Repository` list items and details gain `about: { summary, description, kind, generatedAt } | null`.
Grouped branches gain `jev: { recommendation: "delete"|"archive"|"keep"|"finish_and_merge"; confidence: number;
flags: string[] } | null` (null when Jev is disabled or not run). `getDashboard` adds `openPullRequests`,
`runningAgentRuns`, `lastScan`, and `jevEnabled`.

### Live updates

`GET /api/events` (SSE) emits `{ type: "scan" | "job" | "agent-run" | "inventory", id }` when something changes,
so the UI can invalidate queries; polling every 2 s remains a valid fallback.
