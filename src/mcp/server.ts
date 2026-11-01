import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Schema } from "effect";
import { ListInput, IdInput, ScanInput, Action } from "../domain/model";
import { AgentRunInput, startRun, getRun, listRuns } from "../server/agents";
import { withApp, type ApplicationApi } from "../server/application";
const empty = Schema.Struct({});
export const toolSchemas = {
  list_hosts: empty,
  start_scan: ScanInput,
  get_scan: IdInput,
  list_repositories: ListInput,
  get_repository: IdInput,
  search_branches: ListInput,
  get_branch: IdInput,
  list_worktrees: ListInput,
  list_pull_requests: IdInput,
  get_pull_request: Schema.Struct({
    repo: Schema.String,
    number: Schema.Number,
  }),
  plan_cleanup: ListInput,
  apply_actions: Schema.Struct({ ids: Schema.Array(Schema.String) }),
  delete_branch: Action,
  create_pull_request: Schema.Struct({
    repo: Schema.String,
    head: Schema.String,
    base: Schema.String,
    title: Schema.String,
    body: Schema.optional(Schema.String),
  }),
  merge_pull_request: Schema.Struct({
    repo: Schema.String,
    number: Schema.Number,
  }),
  close_pull_request: Schema.Struct({
    repo: Schema.String,
    number: Schema.Number,
  }),
  start_agent_run: AgentRunInput,
  get_agent_run: IdInput,
  list_agent_runs: empty,
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
    case "plan_cleanup":
      return app.planCleanup(decode(ListInput));
    case "apply_actions":
      return app.applyActions(decode(toolSchemas.apply_actions).ids);
    case "delete_branch": {
      const action = decode(Action);
      if (
        !action.archive &&
        ![
          "merged",
          "patch-merged",
          "squash-merged",
          "content-in-base",
        ].includes(action.state)
      )
        throw Error("Archive required for unmerged branch");
      return app.runAction(action, false);
    }
    case "list_pull_requests":
      return app.forge().listPullRequests(decode(IdInput).id);
    case "get_pull_request": {
      const v = decode(toolSchemas.get_pull_request);
      return app.forge().detail(v.repo, v.number);
    }
    case "create_pull_request": {
      const v = decode(toolSchemas.create_pull_request);
      return app.forge().operation(v.repo, "create", { ...v });
    }
    case "merge_pull_request":
    case "close_pull_request": {
      const v = decode(toolSchemas.merge_pull_request);
      return app
        .forge()
        .operation(v.repo, name === "merge_pull_request" ? "merge" : "close", {
          number: v.number,
        });
    }
    case "start_agent_run":
      return startRun(app, decode(AgentRunInput));
    case "get_agent_run":
      return getRun(app, decode(IdInput).id);
    case "list_agent_runs":
      decode(empty);
      return listRuns(app);
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
