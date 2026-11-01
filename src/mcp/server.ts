import { RepositoryDeletionInput, ApplyActionsInput } from "../domain/model";
import {
  SetRepositoryMutedInput,
  LandingListInput,
  CommitProvenanceInput,
  BranchHistoryInput,
  SyncPullRequestsInput,
} from "../domain/model";
import { startJob, getJob } from "../server/jobs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Schema } from "effect";
import {
  SettingsUpdate,
  ListInput,
  IdInput,
  ScanInput,
  Action,
  PullRequestListInput,
  CreatePullRequestInput,
  MergePullRequestInput,
  PlanActionsInput,
  ActionListInput,
  AgentListInput,
} from "../domain/model";
import {
  AgentRunInput,
  startRun,
  getRun,
  listRuns,
  listAgents,
  cancelRun,
} from "../server/agents";
import { withApp, type ApplicationApi } from "../server/application";
const empty = Schema.Struct({});
export const toolSchemas = {
  get_dashboard: empty,
  set_repository_muted: SetRepositoryMutedInput,
  list_landings: LandingListInput,
  get_commit_provenance: CommitProvenanceInput,
  list_branch_history: BranchHistoryInput,
  sync_pull_requests: SyncPullRequestsInput,
  list_hosts: empty,
  start_scan: ScanInput,
  get_scan: IdInput,
  list_repositories: ListInput,
  get_repository: IdInput,
  search_branches: ListInput,
  get_branch: IdInput,
  list_worktrees: ListInput,
  list_pull_requests: PullRequestListInput,
  refresh_pull_requests: Schema.Struct({
    repo: Schema.optional(Schema.String),
  }),
  get_job: IdInput,
  plan_actions: PlanActionsInput,
  list_actions: ActionListInput,
  list_agents: empty,
  cancel_agent_run: IdInput,
  comment_pull_request: Schema.Struct({
    id: Schema.String,
    body: Schema.String,
  }),
  get_pull_request: IdInput,
  plan_cleanup: ListInput,
  apply_actions: ApplyActionsInput,
  plan_repository_deletion: RepositoryDeletionInput,
  list_deleted_repositories: empty,
  delete_branch: Action,
  create_pull_request: CreatePullRequestInput,
  merge_pull_request: MergePullRequestInput,
  close_pull_request: IdInput,
  start_agent_run: AgentRunInput,
  get_agent_run: Schema.Struct({
    id: Schema.String,
    cursor: Schema.optional(Schema.Number),
  }),
  list_agent_runs: AgentListInput,
  get_settings: empty,
  update_settings: SettingsUpdate,
  update_scan_roots: Schema.Struct({
    host: Schema.String,
    roots: Schema.Array(Schema.String),
  }),
};
const descriptions: Record<keyof typeof toolSchemas, string> = {
  get_dashboard:
    "Read inventory counts, recent scans and forge budgets. Muted repositories are excluded from inventory counts; mutedRepositories reports their count. Does not mutate disk or a forge.",
  set_repository_muted:
    "Persist mute state for a repository key. Muted repositories disappear from default lists and bulk PR sync, but scans and cleanup still include them. Changes only the application database.",
  list_landings:
    "List cached base commit landings for a repository key, with provenance and paging. Does not contact or mutate a forge or disk.",
  get_commit_provenance:
    "Look up cached provenance for a commit SHA in a repository key. Returns null when no landing is known; does not mutate disk or a forge.",
  list_branch_history:
    "List observed branch tips, including disappeared branches, filtered by repository key and paging. Reads the database without changing disk or a forge.",
  sync_pull_requests:
    "Queue incremental PR synchronization for all visible repositories or one explicit repository key (including muted). Returns a job id to poll with get_job; reads forge APIs and updates only the local cache.",
  list_hosts:
    "Read configured scan hosts and their scan roots. Does not contact hosts or mutate disk or a forge.",
  start_scan:
    "Start inventory collection on selected host ids, or all enabled hosts. Returns a scan id to poll with get_scan; fetch may update local remote refs but never mutates a forge.",
  get_scan:
    "Read progress and errors for a scan id returned by start_scan. Does not mutate disk or a forge.",
  list_repositories:
    "List collected repositories, ownership and mute state with filtering and paging. Reads cached inventory without changing disk or a forge.",
  get_repository:
    "Read clones and grouped branches for an exact repository key, including muted repositories. Does not mutate disk or a forge.",
  search_branches:
    "Search grouped local branches by repository key, host id, verdict and other filters. Returns a page from cached inventory without changing disk or a forge.",
  get_branch:
    "Read a grouped branch using its exact repositoryKey#branch id, including muted repositories. Does not mutate disk or a forge.",
  list_worktrees:
    "List collected worktrees and their dirty or missing status with paging. Reads cached inventory without changing disk or a forge.",
  list_pull_requests:
    "List cached PRs with paging, defaulting to open PRs in unmuted repositories. The mine filter matches PR authors; does not contact or mutate a forge or disk.",
  refresh_pull_requests:
    "Queue incremental PR refresh for all unmuted repositories or one explicit repository key. Returns a job id to poll with get_job; reads forge APIs and updates the local cache.",
  get_job:
    "Read progress, results, errors and retry timing for a background job id. Does not mutate disk or a forge.",
  plan_actions:
    "Plan guarded git actions for branch ids, a branch filter or explicit clone targets. Returns a job id to poll with get_job; persists a plan without executing disk or forge mutations.",
  list_actions:
    "List persisted action plans and execution results by repository key or status with paging. Does not mutate disk or a forge.",
  list_agents:
    "Read configured agent ids, available models and default models. Does not launch processes or mutate disk or a forge.",
  cancel_agent_run:
    "Cancel an agent run by its run id and terminate its supervised process. Returns the run record; stops work that may be changing disk or a forge.",
  comment_pull_request:
    "Post a comment to the forge PR identified by repositoryKey!number. Mutates the forge and returns an acknowledgement, not a job id.",
  get_pull_request:
    "Fetch detailed PR data for a repositoryKey!number id, including muted repositories. Reads the forge and updates the local cache; never mutates the forge or clone disk.",
  plan_cleanup:
    "Plan safe deletion of integrated branches matching the filters, including muted repositories by default. Returns a job id to poll with get_job; records plans without changing clone disk or a forge.",
  apply_actions:
    "Execute previously planned action ids after rechecking safety guards. Returns a job id to poll with get_job; may change clone disk and push refs to a forge depending on action kind.",
  delete_branch:
    "Plan deletion for a branch name at a host id and clone path; archive is required for unmerged work. Returns a job id to poll with get_job; use apply_actions to execute the disk and possible forge changes.",
  create_pull_request:
    "Create a forge PR from a grouped branch id and optional clone host id. May push the local branch before creating the PR; returns the PR directly, not a job id.",
  merge_pull_request:
    "Merge a forge PR identified by repositoryKey!number using the selected method. Mutates the forge and optionally deletes its remote branch; returns the updated PR directly.",
  close_pull_request:
    "Close the forge PR identified by repositoryKey!number without merging. Mutates the forge and returns the updated PR directly.",
  start_agent_run:
    "Launch a configured agent id against a repository key and optional branch or PR id. Returns a run id to poll with get_agent_run; may create a worktree and let the agent mutate disk or a forge.",
  get_agent_run:
    "Read an agent run id and events after an optional event cursor. Does not mutate disk or a forge; poll this tool for agent progress.",
  list_agent_runs:
    "List persisted agent runs by repository key or status with paging. Does not launch agents or mutate disk or a forge.",
  get_settings:
    "Read configured hosts, forges, agents and scheduling settings. Token source names may be returned, but resolved forge tokens are never exposed; does not mutate disk or a forge.",
  update_settings:
    "Update application settings (hosts, forges, agents, schedule, archive directory, Jev key). Omitted Jev fields keep stored values and null clears them; returns the redacted settings view, never the key.",
  plan_repository_deletion:
    "Plan deleting a repository's clones from disk (all clones, or the given clone ids) and return a job id to poll with get_job. The result lists what would be lost per clone; nothing is removed until apply_actions runs with confirm equal to the repository name.",
  list_deleted_repositories:
    "List tombstones of repositories deleted from disk, with each clone's host, path and archive location. Reads the database only.",
  update_scan_roots:
    "Replace scan roots for a configured host id and persist the settings. Does not run a scan or change clone disk or a forge.",
};
const fieldDescriptions: Record<string, string> = {
  prEvidence:
    "Optional reviewed PR evidence; planning reloads authoritative evidence from the database.",
  commits: "PR commit SHAs captured as integration evidence.",
  baseSha:
    "Reviewed base commit SHA used to guard deletion against changed evidence.",
  dryRun: "Plan and validate without applying disk changes when true.",
  id: "Exact entity id returned by the corresponding list or start tool.",
  repositoryId:
    "Normalized repository key returned as repository id (host/owner/name or local key).",
  muted:
    "True to mute the repository; false to restore default visibility and bulk PR sync.",
  includeMuted:
    "Include muted repositories when true; defaults to false (cleanup planning defaults to true).",
  mine: "Filter by ownership when provided: repository owner for inventory, PR author for PR lists. False selects non-owned items.",
  repo: "Repository key for inventory tools; absolute clone path for action targets and delete_branch.",
  host: "Configured host id selecting the clone or machine.",
  hosts: "Configured host ids to scan; an empty array scans all enabled hosts.",
  text: "Case-insensitive text search applied before paging.",
  page: "One-based page number, default 1.",
  pageSize: "Items per page, default 50, clamped to 1–200.",
  sort: "Order by name or date; inventory defaults to name.",
  state:
    "Required branch state or PR state; PR lists default to open and accept all.",
  verdict: "Require this grouped branch verdict.",
  verdicts:
    "Match any listed verdict, intersecting the singular verdict filter.",
  jev: "Require this cached classification recommendation.",
  stale: "Filter branches by configured stale age when provided.",
  dirty:
    "Filter by actual worktree changes; missing directories are never dirty.",
  missing: "Filter worktrees by missing directory status.",
  localOnly: "Filter branches by unpushed local work.",
  checks: "Require this cached PR checks summary state.",
  full: "Resync all PR metadata when true; requires an explicit repository key.",
  base: "Base branch name or ref; defaults to the selected clone base for PR creation.",
  since: "Earliest landing timestamp (ISO 8601); defaults to 180 days ago.",
  gone: "True selects disappeared branch tips; false selects currently observed tips.",
  sha: "Full commit SHA to look up in cached landing provenance.",
  target: "SSH destination (alias or user@host) for an ssh host.",
  bun: "Bun executable on the host used to run the collector and worker.",
  enabled: "Whether the host is scanned and used for actions.",
  forges: "Forge integrations (GitHub, Forgejo) used for PR sync and actions.",
  requestReserve:
    "Forge API requests to keep in reserve; sync pauses when the remaining budget reaches it.",
  tokenEnv: "Server environment variable holding the forge token.",
  tokenCommand:
    "Shell command run on the server that prints the forge token; the token is never returned.",
  owners:
    "Forge account or organization logins treated as the user's own (case-insensitive).",
  agents: "Agent launchers (ACP or CLI) available for agent runs.",
  label: "Human-readable name shown in the UI.",
  command: "Executable (and leading arguments) used to launch the agent.",
  args: "Extra arguments; {model} and {prompt} placeholders are substituted for CLI agents.",
  models: "Model ids the agent accepts.",
  defaultModel: "Model id used when a run does not choose one.",
  staleDays: "Days without commits after which a branch counts as stale.",
  worktreeDir: "Directory where the app creates worktrees for agent runs.",
  dailyScanTime: "Local time (HH:MM) of the daily scan.",
  archiveDir:
    "Directory, expanded per host, where clone archives are written before deletion.",
  apiKey:
    "Jev (TypeSafe) API key to store; null clears it, omission keeps the stored key.",
  apiKeyCommand:
    "Shell command printing the Jev API key; null clears it, omission keeps it.",
  confirm:
    "Repository display name; required to apply delete-clone actions, otherwise the whole call is rejected.",
  cloneIds:
    "Clone ids (host:absolute path) of the repository to delete; omit to select every clone.",
  fetch:
    "Fetch and prune remote refs during scanning when true; does not write to a forge.",
  branchId: "Exact grouped branch id: repositoryKey#branch.",
  branchIds: "Exact grouped branch ids to plan actions for.",
  pullRequestId: "Exact PR id: repositoryKey!number.",
  cloneHost: "Optional configured host id used to choose the source clone.",
  title: "Title for the new forge pull request.",
  body: "Markdown PR body or comment text to send to the forge.",
  draft: "Create the PR as a draft when true.",
  method: "Forge merge method: merge, squash or rebase.",
  deleteRemoteBranch:
    "Delete the PR head branch on the forge after merging when true.",
  ids: "Previously planned action ids to execute after safety revalidation.",
  kind: "Action kind to plan, or configured agent execution kind.",
  filter: "Branch selection filters applied before action planning.",
  targets: "Explicit action targets identifying host id and clone path.",
  branch: "Local branch name at the selected clone path.",
  worktree:
    "Agent worktree mode (new, existing, none), or worktree path in an action target.",
  remote: "Git remote name for the action; defaults according to action kind.",
  url: "New remote URL for set-remote-url actions.",
  archive:
    "Required true to archive unmerged work on the forge before planned local deletion.",
  status: "Exact persisted action or agent-run status to select.",
  agentId: "Configured agent id from list_agents.",
  model: "Configured agent model; defaults to the agent default model.",
  task: "Agent task template to execute for the selected repository.",
  note: "Additional instructions appended to the agent task prompt.",
  cursor: "Last seen agent event sequence number; returns only newer events.",
  roots: "Replacement scan root directories interpreted on the selected host.",
};
function describeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(describeFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "properties" && child && typeof child === "object"
        ? Object.fromEntries(
            Object.entries(child).map(([field, schema]) => {
              const description = fieldDescriptions[field];
              if (!description)
                throw Error("Missing MCP input description: " + field);
              return [
                field,
                { ...(describeFields(schema) as object), description },
              ];
            }),
          )
        : describeFields(child),
    ]),
  );
}
export const toolList = () =>
  Object.entries(toolSchemas).map(([name, schema]) => ({
    name,
    description: descriptions[name as keyof typeof toolSchemas],
    inputSchema: {
      type: "object" as const,
      ...(describeFields(Schema.toJsonSchemaDocument(schema).schema) as object),
    },
  }));
export async function callTool(
  app: ApplicationApi,
  name: string,
  input: unknown,
): Promise<unknown> {
  const decode = <S extends Schema.ConstraintDecoder<unknown>>(s: S) =>
    Schema.decodeUnknownSync(s)(input);
  switch (name) {
    case "get_dashboard":
      decode(empty);
      return app.dashboard();
    case "set_repository_muted":
      return app.setRepositoryMuted(decode(SetRepositoryMutedInput));
    case "list_landings":
      return app.listLandings(decode(LandingListInput));
    case "get_commit_provenance":
      return app.getCommitProvenance(decode(CommitProvenanceInput));
    case "list_branch_history":
      return app.listBranchHistory(decode(BranchHistoryInput));
    case "sync_pull_requests": {
      const input = decode(SyncPullRequestsInput);
      return startJob(
        app,
        "sync-pull-requests",
        () => app.syncPullRequests(input),
        input,
      );
    }

    case "list_hosts":
      decode(empty);
      return app.settings().hosts;
    case "update_settings":
      return app.updateSettings(decode(SettingsUpdate));
    case "get_settings":
      decode(empty);
      return app.settingsView();
    case "update_scan_roots": {
      const v = decode(toolSchemas.update_scan_roots);
      const s = app.settings();
      if (!s.hosts.some((h) => h.id === v.host)) throw Error("Host missing");
      return app.updateSettings({
        ...s,
        hosts: s.hosts.map((h) =>
          h.id === v.host ? { ...h, roots: v.roots } : h,
        ),
      });
    }
    case "start_scan":
      return app.startScan(decode(ScanInput), "mcp");
    case "get_scan":
      return app.getScan(decode(IdInput).id);
    case "list_repositories":
      return app.listRepositories(decode(ListInput));
    case "get_repository":
      return app.getRepository(decode(IdInput).id);
    case "search_branches":
      return app.searchBranches(decode(ListInput));
    case "get_branch":
      return app.getBranch(decode(IdInput).id);
    case "list_worktrees":
      return app.listWorktrees(decode(ListInput));
    case "get_job":
      return getJob(app, decode(IdInput).id);
    case "plan_actions":
      return startJob(app, "plan-actions", () =>
        app.planActions(decode(PlanActionsInput)),
      );
    case "plan_cleanup":
      return startJob(app, "plan-actions", () =>
        app.planCleanup(decode(ListInput)),
      );
    case "plan_repository_deletion": {
      const v = decode(RepositoryDeletionInput);
      return startJob(app, "repository-deletion-plan", () =>
        app.planRepositoryDeletion(v),
      );
    }
    case "list_deleted_repositories":
      decode(empty);
      return app.listDeletedRepositories();
    case "apply_actions": {
      const v = decode(ApplyActionsInput);
      app.validateDeletionConfirmation(v.ids, v.confirm);
      return startJob(app, "apply-actions", () =>
        app.applyActions(v.ids, v.confirm),
      );
    }
    case "list_actions":
      return app.listActions(decode(ActionListInput));
    case "delete_branch": {
      const v = decode(Action);
      return startJob(app, "plan-actions", () =>
        app.planActions({
          kind: v.archive ? "archive-and-delete" : "delete-branch",
          targets: [
            { host: v.host, repo: v.repo, branch: v.branch, remote: v.remote },
          ],
        }),
      );
    }
    case "list_pull_requests":
      return app.listPullRequests(decode(PullRequestListInput));
    case "get_pull_request":
      return app.getPullRequest(decode(IdInput).id);
    case "refresh_pull_requests": {
      const input = decode(toolSchemas.refresh_pull_requests);
      return startJob(
        app,
        "refresh-pull-requests",
        () => app.refreshPullRequests(input.repo),
        input,
      );
    }
    case "create_pull_request":
      return app.createPullRequest(decode(CreatePullRequestInput));
    case "merge_pull_request":
      return app.mergePullRequest(decode(MergePullRequestInput));
    case "close_pull_request":
      return app.closePullRequest(decode(IdInput).id);
    case "comment_pull_request":
      return app.commentPullRequest(decode(toolSchemas.comment_pull_request));
    case "list_agents":
      return listAgents(app);
    case "cancel_agent_run":
      return cancelRun(app, decode(IdInput).id);
    case "start_agent_run":
      return startRun(app, decode(AgentRunInput));
    case "get_agent_run": {
      const v = decode(toolSchemas.get_agent_run);
      return getRun(app, v.id, v.cursor);
    }
    case "list_agent_runs":
      return listRuns(app, decode(AgentListInput));
    default:
      throw Error("Unknown tool");
  }
}
export async function handleMcp(
  request: Request,
  run: <T>(f: (a: ApplicationApi) => Promise<T> | T) => Promise<T> = withApp,
) {
  if (
    process.env.MCP_TOKEN &&
    request.headers.get("authorization") !== `Bearer ${process.env.MCP_TOKEN}`
  )
    return new Response("Unauthorized", { status: 401 });
  const server = new Server(
    { name: "repo-review", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolList(),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await run((a) =>
        callTool(a, req.params.name, req.params.arguments ?? {}),
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result ?? null) }],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: String(e) }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
