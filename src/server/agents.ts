import { json, type Json } from "../domain/json";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { Schema } from "effect";
import { git, expand } from "../collector/git";
import type { ApplicationApi } from "./application";
export const AgentRunInput = Schema.Struct({
  agent: Schema.String,
  repo: Schema.String,
  branch: Schema.String,
  prompt: Schema.String,
  model: Schema.optional(Schema.String),
  existingWorktree: Schema.optional(Schema.String),
  task: Schema.optional(
    Schema.Literals([
      "review-branch",
      "make-pr",
      "review-pr",
      "cleanup-repo",
      "custom",
    ]),
  ),
});
export type AgentRunInput = typeof AgentRunInput.Type;
export type AgentRun = {
  id: string;
  agent: string;
  repo: string;
  branch: string;
  cwd: string;
  model: string;
  status: string;
  events: Json[];
  summary: string;
  started: string;
  finished?: string;
};
const live = new Map<string, () => void>();
export function listRuns(app: ApplicationApi) {
  return app.db.list<AgentRun>("agent");
}
export function getRun(app: ApplicationApi, id: string, cursor = 0) {
  const run = app.db.get<AgentRun>("agent", id);
  return run
    ? { ...run, events: run.events.slice(cursor), cursor: run.events.length }
    : null;
}
export function cancelRun(app: ApplicationApi, id: string) {
  const cancel = live.get(id);
  if (!cancel) throw Error("Run not active in this process");
  cancel();
  const run = app.db.get<AgentRun>("agent", id)!;
  app.db.put("agent", id, {
    ...run,
    status: "cancelled",
    finished: new Date().toISOString(),
  });
  return { id, status: "cancelled" };
}
export async function startRun(app: ApplicationApi, input: AgentRunInput) {
  const config = app.settings();
  const agent = config.agents.find((a) => a.id === input.agent);
  if (!agent) throw Error("Agent not configured");
  const model = input.model ?? agent.defaultModel;
  if (!agent.models.includes(model)) throw Error("Model not configured");
  const id = crypto.randomUUID();
  let cwd: string;
  if (input.existingWorktree) {
    cwd = await realpath(input.existingWorktree);
    const rows = git(input.repo, "worktree", "list", "--porcelain");
    if (rows.code || !rows.out.split("\n").includes("worktree " + cwd))
      throw Error("Existing directory is not a worktree of this repository");
  } else {
    const root = expand(config.worktreeDir);
    await mkdir(root, { recursive: true });
    cwd = join(root, id);
    const add = git(
      input.repo,
      "worktree",
      "add",
      "-b",
      "agent/" + id,
      cwd,
      input.branch,
    );
    if (add.code) throw Error("Cannot create run worktree");
  }
  const run: AgentRun = {
    id,
    agent: agent.id,
    repo: input.repo,
    branch: input.branch,
    cwd,
    model,
    status: "running",
    events: [],
    summary: "",
    started: new Date().toISOString(),
  };
  const save = () => app.db.put("agent", id, run);
  const event = (e: unknown) => {
    run.events.push({ at: new Date().toISOString(), event: json(e) });
    save();
  };
  save();
  const args = agent.args.map((a) =>
    a.replaceAll("{model}", model).replaceAll("{prompt}", input.prompt),
  );
  if (agent.kind === "cli" && !agent.args.some((a) => a.includes("{prompt}")))
    args.push(input.prompt);
  const p = spawn(agent.command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  p.stdin.on("error", () => {});
  let cancelled = false;
  live.set(id, () => {
    cancelled = true;
    p.kill("SIGTERM");
  });
  p.stderr.on("data", (b: Buffer) =>
    event({ type: "stderr", text: b.toString() }),
  );
  void (async () => {
    const timeout = setTimeout(
      () => {
        p.kill("SIGKILL");
      },
      30 * 60 * 1000,
    );
    try {
      if (agent.kind === "cli") {
        p.stdin.end();
        p.stdout.on("data", (b: Buffer) => {
          run.summary += b.toString();
          event({ type: "stdout", text: b.toString() });
        });
        await new Promise<void>((ok, fail) => {
          p.on("error", fail);
          p.on("close", (code) =>
            code === 0 ? ok() : fail(Error(`Agent exited ${code}`)),
          );
        });
      } else {
        const stream = ndJsonStream(
          Writable.toWeb(p.stdin) as WritableStream<Uint8Array>,
          Readable.toWeb(p.stdout) as unknown as ReadableStream<Uint8Array>,
        );
        await client()
          .onNotification("session/update", ({ params }) => {
            event(params);
            if (
              params.update.sessionUpdate === "agent_message_chunk" &&
              params.update.content.type === "text"
            )
              run.summary += params.update.content.text;
          })
          .onRequest("session/request_permission", ({ params }) => {
            event(params);
            const locations = params.toolCall.locations ?? [];
            const inside = locations.every((l) => {
              const rel = relative(cwd, resolve(cwd, l.path));
              return (
                rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/")
              );
            });
            const choice = inside
              ? params.options.find(
                  (o) => o.kind === "allow_once" || o.kind === "allow_always",
                )
              : undefined;
            return {
              outcome: choice
                ? { outcome: "selected" as const, optionId: choice.optionId }
                : { outcome: "cancelled" as const },
            };
          })
          .connectWith(stream, async (ctx) => {
            await ctx.request("initialize", {
              protocolVersion: PROTOCOL_VERSION,
              clientCapabilities: {},
            });
            const session = await ctx.request("session/new", {
              cwd,
              mcpServers: [],
            });
            await ctx.request("session/set_config_option", {
              sessionId: session.sessionId,
              configId: "model",
              value: model,
            });
            event(
              await ctx.request("session/prompt", {
                sessionId: session.sessionId,
                prompt: [{ type: "text", text: input.prompt }],
              }),
            );
          });
        p.kill();
      }
      run.status = cancelled ? "cancelled" : "done";
    } catch (e) {
      run.status = cancelled ? "cancelled" : "failed";
      event({ type: "error", message: String(e) });
    } finally {
      clearTimeout(timeout);
      p.kill();
      run.finished = new Date().toISOString();
      save();
      live.delete(id);
    }
  })();
  return { id };
}
