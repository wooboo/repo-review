import {
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
  apply_actions: Schema.Struct({ ids: Schema.Array(Schema.String) }),
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
  update_scan_roots: Schema.Struct({
    host: Schema.String,
    roots: Schema.Array(Schema.String),
  }),
};
export const toolList = () =>
  Object.entries(toolSchemas).map(([name, schema]) => ({
    name,
    description: name.replaceAll("_", " "),
    inputSchema: {
      type: "object" as const,
      ...Schema.toJsonSchemaDocument(schema).schema,
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
    case "get_settings":
      decode(empty);
      return app.settings();
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
        app.planActions({ kind: "delete-branch", filter: decode(ListInput) }),
      );
    case "apply_actions":
      return startJob(app, "apply-actions", () =>
        app.applyActions(decode(toolSchemas.apply_actions).ids),
      );
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
