# repo-review — specification

A self-hosted, mobile-first web app for keeping many git repositories, branches and worktrees in order across
several machines. It scans the configured hosts, shows what is merged, stale, unpushed or dirty, deletes what is
safe to delete, handles pull requests, and hands work to AI coding agents. Agents can drive all of it through an
MCP server.

Single user, trusted network, no authentication (for now). English only.

## 1. Agreed stack (fit table)

| Concern                         | Verdict       | Choice / reason                                                                                               |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- |
| Language                        | keep          | TypeScript 7 (`strict`, no `any`)                                                                             |
| Runtime, package manager, tests | keep          | Bun (`bun install`, `bun test`)                                                                               |
| Framework                       | keep          | TanStack Start (React, file routes, server functions), Nitro `bun` preset                                     |
| DB                              | keep          | SQLite via `bun:sqlite` + Drizzle ORM, drizzle-kit migrations applied at start, WAL                           |
| Styling, components             | keep          | Tailwind CSS v4, shadcn/ui, lucide-react icons                                                                |
| Logic, validation               | keep          | Effect v4 services/layers, typed errors, `Schema` for every domain type and input                             |
| URL state                       | keep          | every view is a route; filters/sort/paging in the query string (`validateSearch` + Schema, defaults stripped) |
| i18n                            | trim          | English only, no locale switcher; user-visible strings still live in one messages module, not inline          |
| Dark mode                       | keep          | light / dark / system (default system), cookie, no flash                                                      |
| Palettes                        | trim          | two palettes (neutral + one accent), cookie                                                                   |
| MCP server                      | keep          | `/mcp`, Streamable HTTP, official TS SDK; no auth unless `MCP_TOKEN` is set                                   |
| Host collector                  | swap          | TypeScript single-file collector run with Bun on each host (local spawn or `ssh host bun run -`); no Python   |
| AI agents                       | add           | ACP (Agent Client Protocol) and plain CLI agents, model chosen per run                                        |
| Jev (TypeSafe)                  | add, optional | calibrated junk classification; enabled only when `TYPESAFE_API_KEY` is set                                   |
| Postgres                        | drop          | one instance on one host                                                                                      |

## 2. Domain

- **Host**: a machine to scan. `local` (the app's own machine) or `ssh` (an SSH target such as `minion`).
  Each host has scan roots (directories, editable in the app), an optional Bun path, enabled flag.
- **Repository**: identity shared by all clones of the same project, keyed by the normalized URL of `origin`
  (`host/owner/repo`, lower case, no scheme, credentials or `.git`). A clone whose origin points elsewhere joins a
  forge repository when (1) one of its remotes points there, (2) the forge migrated it from the clone's origin
  (`original_url`), or (3) a same-named forge repository contains the clone's root commit (checked via API).
  A same-name repository without that commit is reported as unrelated. Repos without remotes: `local/<name>@<root sha>`.
- **Clone**: one repository directory on one host (several clones of one repo on one host are allowed).
- **Branch** (local), **remote branch**, **worktree**, **stash**: as in git, per clone.
- **Base**: candidate bases are the default branch of every remote (from `refs/remotes/<r>/HEAD`, else `ls-remote
--symref`) plus `main`, `master`, `integration`, `develop`, `trunk` on `origin`/`upstream`; without remotes, a
  local trunk. Each branch picks the candidate with the fewest commits ahead (ties: origin's default).
- **Branch state** (per clone), first match wins:
  `base` · `merged` (ancestor of base) · `patch-merged` (`git cherry` shows no unique commit) · `squash-merged`
  (patch-id of the whole `merge-base..branch` diff equals one base commit after the merge-base touching the same
  files, `--full-diff`) · `content-in-base` (every file the branch changed has the branch's content in base) ·
  `unmerged`.
- **Verdict** (per branch name across all clones of a repo, combining states, PRs, worktrees, threads):
  `base`, `delete` (integrated on every clone, or PR merged with the same head; no dirty worktree, no active
  agent), `check` (integrated but dirty worktree / active agent), `pr-open`, `local-only` (unmerged commits on no
  remote), `pr-closed`, `pr-merged-changed`, `unmerged` (pushed, no PR). Flags: stale (> 60 days), upstream gone,
  contained in other refs, different SHAs across clones, operation in progress, linked agent threads.

## 3. Architecture

```
src/
  domain/        Effect Schema types, pure logic (verdicts, url normalisation, search params)
  db/            Drizzle schema, client (WAL, migrations at start), repository service (only layer that knows SQL)
  server/        Effect services + thin createServerFn adapters
    hosts/       HostRunner: run the collector / worker locally or over SSH, stream JSON lines
    scan/        ScanService: queue, run, ingest snapshots, schedule
    actions/     ActionService: plan + execute destructive git operations through the host worker
    forge/       ForgeService: GitHub + Forgejo/Gitea clients (PRs, repo metadata, identity checks)
    agents/      AgentService: ACP + CLI runners, run log, worktree management
    classify/    JevService (optional), DescribeService (AI repo descriptions)
  collector/     host-side TypeScript (no app imports, no npm deps, Node/Bun built-ins only),
                 bundled at build time into one script string
  mcp/           MCP server route + tool adapters over the same services
  routes/, components/   UI
```

Rules: server functions and MCP tools are thin adapters over the same Effect services; inputs validated with
Schema; one shared `ManagedRuntime`; typed errors mapped to HTTP/user errors. Long operations (scans, actions,
agent runs) are jobs: they get an id immediately, run in the server process, persist progress to the DB, and the
UI polls (or subscribes via SSE) until done.

### 3.1 Host collector protocol

The collector is one TypeScript entry (`src/collector/main.ts`) bundled with `bun build --target=bun` into a
single string at build time. The app runs it as `bun run - <args>` locally or `ssh -o BatchMode=yes <target>
<bun> run - <args>` with the script on stdin. It must only use Bun/Node built-ins (`node:child_process`,
`node:fs`, `bun:sqlite`), never write anything except `git fetch --prune --no-tags` (optional), and print
newline-delimited JSON: progress events and one final `snapshot` object with a `version` field.

Arguments: `--host <id>`, `--root <dir>` (repeatable), `--fetch`/`--no-fetch`, `--repo <substring>`,
`--t3`/`--no-t3`, `--jobs <n>`. Environment for git: `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`,
`GIT_SSH_COMMAND="ssh -o BatchMode=yes"`.

Per repository (dedupe by absolute `--git-common-dir`): worktrees (path, HEAD, branch, detached, locked,
prunable, exists, status counts staged/unstaged/untracked/conflicts, up to 300 files with mtimes, newest change,
operations in progress, submodules, last git activity, linked agent/T3 threads), remotes (url, pushurl,
normalized key, fetch result, last fetch time, default branch), bases, root commits, first/last commit dates,
stashes, local branches (sha, dates, author, subject, upstream + track, ahead/behind vs upstream, same-name
branch on each remote, unpushed count, unique count, ahead/behind vs every base, chosen base, merge-base and its
date, date the base started moving away, first/last own commit, own commits (last 25), diffstat, cherry counts,
squash commit, residual diff vs base, contained-in refs, state), origin remote branches (same analysis, capped),
other remotes' branch counts, and "about" material (README ≤ 6 kB, AGENTS.md/CLAUDE.md, manifests, top level,
file extensions, recent commits, commit count) for descriptions. Remote URLs are stripped of credentials.
Errors are recorded per repo and never abort the scan.

Discovery: walk each scan root (depth 3, 4 under `worktrees` dirs), skip `node_modules`, `.git`, dot dirs,
symlinks, `vendor`, `dist`, `build`, `.next`, `target`, `.venv`. Optional T3 integration: read-only
`~/.t3/userdata/statev2.sqlite` (and `/Volumes/*/.t3/userdata/statev2.sqlite`) for project roots and threads
(worktree path, branch, title, latest run status). Opening a database on an external macOS volume can block
when the process lacks disk permissions, so this is optional (`--no-t3`) and must run with a timeout.

### 3.2 Host worker (destructive actions)

A second bundled entry (`src/collector/worker.ts`) receives a JSON payload and executes actions, re-checking
everything immediately before each operation:

- branch still at the reviewed SHA; the reviewed base SHA is still an ancestor of the current base;
  for `merged`, the branch is still an ancestor of the base;
- every worktree of the branch exists, is not the main checkout, not locked, has no tracked/untracked changes,
  no operation in progress, no submodules, HEAD equals the branch; no process has its cwd inside
  (`lsof -d cwd`); no running agent/T3 thread uses the worktree or records the branch;
- worktree removal only with plain `git worktree remove` (no `--force`); branch deletion with
  `git update-ref -d refs/heads/<b> <sha>` (fails if the ref moved) plus removing its config section.
- Deleting an **unmerged** branch is a separate action that first pushes it to the forge as
  `archive/<yyyy-mm-dd>/<branch>` and verifies the remote ref, and only then deletes locally.
- Other actions: switch a main checkout to its base when clean (and detach another worktree holding the base
  if it is clean and equal to the base), fast-forward a local base, prune a missing worktree entry only when its
  admin dir has no staged index changes, set a remote URL / rename remotes, push a branch.

Every result is persisted (`actions` table) with status `planned|running|done|skipped|blocked|failed`, reason,
SHA, and a restore command (`git -C <repo> branch <name> <sha>`). Planning (dry run) uses the same code path.

## 4. Data model (SQLite)

Current state is replaced per host on each successful scan; history keeps scan summaries and actions.

- `settings` (key, json value): hosts, forges (host, kind `github|forgejo`, token source: env var name or
  command such as `gh auth token`), agents, schedule (daily scan time), stale days, worktree dir for agent runs.
- `scans` (id, trigger `ui|mcp|schedule`, hosts, fetch, status, started/finished, per-host result, errors)
- `repositories` (key, name, forge, description fields, identity info), `clones`, `branches`, `remote_branches`,
  `worktrees`, `worktree_files`, `stashes`, `pull_requests` (forge cache: number, state, head, head sha, base,
  title, url, draft, checks summary, updated), `actions`, `agent_runs` (+ `agent_run_events` log lines),
  `classifications` (Jev answers per branch fingerprint), `descriptions` (per repo fingerprint).

JSON columns as text with a Schema codec, timestamps as ISO strings, all SQL behind the repository service.

## 5. Forges

GitHub (REST, token from `gh auth token` or `GITHUB_TOKEN`) and Forgejo/Gitea (REST `/api/v1`, token from an env
var or a configured command). Operations: list PRs (all states, paged), PR detail (diff, files, checks/statuses,
reviews), create PR from a branch, merge (method), close, comment; repository metadata, search (for identity),
commit existence (root-commit check), create repository (private by default) and push for moved/missing repos.
Results cached in `pull_requests`; refreshed after scans and on demand.

## 6. AI agents

Configured in settings: id, label, kind `acp|cli`, command + args, available models, default model. Examples:
Claude Code through its ACP adapter, Codex through `codex-acp`, Gemini CLI with ACP, `claude -p --model <m>`,
`codex exec -m <m>`. An agent run has a task kind (`review-branch`, `make-pr`, `review-pr`, `cleanup-repo`,
`custom`), target (repo/clone/branch/PR), prompt built from a template plus the user's note, model, working
directory (a new worktree created under the configured dir from the target branch, or an existing worktree),
status, streamed log (messages, tool calls, permission requests), final summary, cost if reported, linked PR.
ACP runs use `@agentclientprotocol/sdk` over stdio; permission requests are answered by a per-run policy
(`allow-all` inside the run's worktree by default). Runs can be cancelled. Repository descriptions use the same
agent abstraction (default: a small model with a JSON schema, no tools), cached per content fingerprint.

## 7. Jev (optional)

`POST https://api.typesafe.ai/v1/systemone` with model `jev-1.14.0`, `state` = compact English JSON about one
branch (name, subjects of own commits, diffstat, age bucket as words, state, verdict, flags — no raw dates or
arithmetic), questions: nouls `abandoned_experiment`, `backup_snapshot`, `work_in_progress_worth_keeping`,
`duplicate_of_other_work`, `generated_or_bot_branch`; choice `recommendation` (`delete`, `archive`, `keep`,
`finish_and_merge`). Answers stored per branch fingerprint; shown as badges and filters. Off when the key is unset.

## 8. MCP tools

Mounted at `/mcp` (Streamable HTTP). Read tools are paged and compact; write tools validate like the UI.
`list_hosts`, `start_scan`, `get_scan`, `list_repositories`, `get_repository`, `search_branches` (filters: host,
repo, verdict, state, stale, dirty, local-only, text), `get_branch`, `list_worktrees`, `list_pull_requests`,
`get_pull_request`, `plan_cleanup`, `apply_actions` (only planned, still-valid action ids), `delete_branch`
(with `archive: true` required for unmerged), `create_pull_request`, `merge_pull_request`, `close_pull_request`,
`start_agent_run`, `get_agent_run`, `list_agent_runs`, `get_settings`, `update_scan_roots`.

## 9. UI

Mobile first (360 px), bottom navigation on mobile, sidebar on desktop. Routes: `/` (attention: counts, stale
and local-only work, dirty worktrees, open PRs, running jobs), `/repos`, `/repos/$repo` (description, clones,
remotes, bases, branches, worktrees, stashes, PRs), `/branches` (global, filters in the URL), `/branches/$id`,
`/worktrees`, `/prs`, `/prs/$pr`, `/agents`, `/agents/$run`, `/scans`, `/settings` (hosts + scan roots, forges,
agents, schedule). Destructive actions: plan → review sheet (what will happen, what is skipped and why) →
confirm. Every list has empty/loading (skeleton)/error states.

## 10. Operations

Env: `PORT`, `DATABASE_PATH` (outside the repo), optional `MCP_TOKEN`, `TYPESAFE_API_KEY`, `GITHUB_TOKEN`.
Run in production with `bun .output/server/index.mjs` as a systemd user service. Scheduled daily scan inside the
server process. Backups: copy of the SQLite file (`VACUUM INTO`) daily.

## Backend implementation status

Contract v2 in API.md replaces the foundation's provisional forge/action/agent
interfaces. The backend now has normalized PRs, all seven planned action kinds,
task templates, cursor events, SSE invalidation, restart recovery, durable schedule
claims, retained SQLite backups, and per-entity Drizzle migrations with inventory
relations. Read-only host validation and temporary-repository safety tests are
recorded in the backend PR.

The upgrade preserves settings and requires a fresh inventory scan. Snapshot JSON
remains the collector boundary and grouped inventory read model; relational
projections support entity joins and integrity, and SQL handles PR/action/run
filtering and paging. Subsystem layers share one application lifetime.

Agent execution supports local and SSH-host clones. Remote process groups are
supervised and terminated when their SSH input closes. Use a home-relative
worktree directory for hosts with different filesystem layouts. Description and
Jev integrations validate their structured results, but live Jev calibration still
requires an API key. The UI
remains separately owned and is not part of this backend change.
