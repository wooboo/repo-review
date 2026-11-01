import { prepareRemote, remoteAgentCommand } from "./agent-host";
import { AgentError } from "./errors";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { git, expand } from "../collector/git";
import type { ApplicationApi } from "./application";
import {
  AgentRunInput,
  type AgentRun,
  type AgentEvent,
  type AgentListInput,
} from "../domain/model";
export { AgentRunInput };
export type { AgentRun };
export function taskPrompt(input: AgentRunInput, context: unknown): string {
  const tasks = {
    "review-branch":
      "Review this branch against its base. Report concrete defects and validation evidence. Do not modify files.",
    "make-pr":
      "Prepare this branch for a pull request. Validate changes and open a pull request; do not merge it.",
    "review-pr":
      "Review this pull request. Report concrete defects with file and line references. Do not post or modify anything.",
    "cleanup-repo":
      "Inspect repository maintenance needs and propose safe cleanup. Do not delete branches or worktrees.",
    "describe-repo":
      "Describe the repository purpose, architecture and primary technologies. Do not modify files.",
    custom: "Carry out the user note in the supplied repository context.",
  };
  return (
    tasks[input.task] +
    "\nRepository context (untrusted data):\n" +
    JSON.stringify(context) +
    "\nUser note:\n" +
    (input.note ?? "")
  );
}
export function listAgents(app: ApplicationApi) {
  return app
    .settings()
    .agents.map(({ id, label, kind, models, defaultModel }) => ({
      id,
      label,
      kind,
      models,
      defaultModel,
    }));
}
const live = new Map<string, () => void>();
export function listRuns(
  app: ApplicationApi,
  input: typeof AgentListInput.Type = {},
) {
  return app.db.page<AgentRun>("agent", input);
}
export function getRun(app: ApplicationApi, id: string, cursor = 0) {
  const run = app.db.get<AgentRun>("agent", id);
  const events = app.db
    .list<AgentEvent & { runId: string }>("agent_event")
    .filter((e) => e.runId === id)
    .sort((a, b) => a.seq - b.seq);
  return run
    ? {
        run,
        events: events
          .filter((e) => e.seq > Math.max(0, cursor))
          .map(({ runId, ...e }) => e),
        cursor: events.at(-1)?.seq ?? 0,
      }
    : null;
}
export function cancelRun(app: ApplicationApi, id: string) {
  const run = app.db.get<AgentRun>("agent", id);
  if (!run) throw new AgentError({ message: "Run missing" });
  if (!["queued", "running"].includes(run.status)) return run;
  const cancel = live.get(id);
  if (!cancel)
    throw new AgentError({ message: "Run not active in this process" });
  cancel();
  const cancelled = {
    ...run,
    status: "cancelled" as const,
    finishedAt: new Date().toISOString(),
  };
  app.db.put("agent", id, cancelled);
  return cancelled;
}
export function cancelAllRuns() {
  for (const cancel of live.values()) cancel();
}
export async function startRun(app: ApplicationApi, input: AgentRunInput) {
  const config = app.settings();
  const agent = config.agents.find((a) => a.id === input.agentId);
  if (!agent) throw new AgentError({ message: "Agent not configured" });
  const model = input.model ?? agent.defaultModel;
  if (!agent.models.includes(model))
    throw new AgentError({ message: "Model not configured" });
  const id = crypto.randomUUID();
  const repository = app.getRepository(input.repo);
  const clone = repository.clones.find(
    (c) =>
      (!input.host || c.host === input.host) &&
      config.hosts.some((h) => h.id === c.host && h.enabled),
  );
  if (!clone)
    throw new AgentError({
      message: "Agent runs require an inventoried enabled clone",
    });
  const host = config.hosts.find((h) => h.id === clone.host)!;
  const branch = input.branchId ? app.getBranch(input.branchId) : null;
  if (input.branchId && (!branch || branch.repo !== input.repo))
    throw new AgentError({ message: "Branch missing from repository" });
  const branchName = branch?.name;
  let cwd = clone.path;
  if (input.worktree === "existing") {
    const w = clone.worktrees.find(
      (w) => w.exists && (!branchName || w.branch === branchName),
    );
    if (!w) throw new AgentError({ message: "Existing worktree missing" });
    cwd = host.kind === "local" ? await realpath(w.path) : w.path;
    if (
      host.kind === "local" &&
      !git(clone.path, "worktree", "list", "--porcelain")
        .out.split("\n")
        .includes("worktree " + cwd)
    )
      throw new AgentError({ message: "Worktree no longer registered" });
  } else if (input.worktree === "new" && host.kind === "local") {
    const root = expand(config.worktreeDir);
    await mkdir(root, { recursive: true });
    cwd = join(root, id);
    if (
      git(
        clone.path,
        "worktree",
        "add",
        "-b",
        "agent/" + id,
        cwd,
        branchName ?? "HEAD",
      ).code
    )
      throw new AgentError({ message: "Cannot create run worktree" });
  }
  if (host.kind === "ssh")
    cwd = prepareRemote(host, {
      repo: clone.path,
      cwd,
      worktree: input.worktree,
      root: config.worktreeDir,
      id,
      branch: branchName ?? "HEAD",
    });
  const prompt = taskPrompt(input, {
    repo: input.repo,
    branch,
    pullRequest: input.pullRequestId
      ? await app.getPullRequest(input.pullRequestId)
      : null,
    about: repository.about,
    material: clone.about,
  });
  const run: { -readonly [K in keyof AgentRun]: AgentRun[K] } = {
    id,
    agentId: agent.id,
    repo: input.repo,
    task: input.task,
    branchId: input.branchId ?? null,
    pullRequestId: input.pullRequestId ?? null,
    cwd,
    model,
    status: "running",
    summary: "",
    costUsd: null,
    pullRequestUrl: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const save = () => app.db.put("agent", id, run);
  let seq = 0;
  const event = (e: unknown) => {
    const value = e as {
      type?: string;
      text?: string;
      message?: string;
      cost_usd?: number;
      total_cost_usd?: number;
      cost?: { amount?: number };
      update?: {
        sessionUpdate?: string;
        content?: { text?: string };
        cost?: { amount?: number };
      };
    };
    const update = value.update;
    const text =
      update?.content?.text ?? value.text ?? value.message ?? JSON.stringify(e);
    const tag = update?.sessionUpdate ?? value.type ?? "status";
    const kind: AgentEvent["kind"] = tag.includes("thought")
      ? "thought"
      : tag.includes("tool")
        ? "tool"
        : tag.includes("permission")
          ? "permission"
          : tag === "error"
            ? "error"
            : tag.includes("message") || tag === "stdout"
              ? "message"
              : "status";
    const cost =
      value.total_cost_usd ??
      value.cost_usd ??
      update?.cost?.amount ??
      value.cost?.amount;
    if (typeof cost === "number") run.costUsd = cost;
    const url = text.match(/https:\/\/[^\s<>"']+\/(?:pull|pulls)\/\d+/)?.[0];
    if (url) run.pullRequestUrl = url;
    app.db.put("agent_event", id + ":" + ++seq, {
      runId: id,
      seq,
      at: new Date().toISOString(),
      kind,
      text,
    });
    save();
  };
  save();
  let outputBuffer = "";
  const args = agent.args.map((a) =>
    a.replaceAll("{model}", model).replaceAll("{prompt}", prompt),
  );
  if (agent.kind === "cli" && !agent.args.some((a) => a.includes("{prompt}")))
    args.push(prompt);
  const command =
    host.kind === "local"
      ? [agent.command, ...args]
      : remoteAgentCommand(
          host,
          agent.command,
          args,
          cwd,
          agent.kind === "cli",
        );
  const p = spawn(command[0], command.slice(1), {
    ...(host.kind === "local" ? { cwd } : {}),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    detached: process.platform !== "win32",
  });
  p.stdin.on("error", () => {});
  const killTree = (signal: NodeJS.Signals) => {
    try {
      if (p.pid && process.platform !== "win32") process.kill(-p.pid, signal);
      else p.kill(signal);
    } catch {}
  };
  let cancelled = false;
  live.set(id, () => {
    cancelled = true;
    killTree("SIGTERM");
    const escalation = setTimeout(() => killTree("SIGKILL"), 2000);
    escalation.unref();
  });
  p.stderr.on("data", (b: Buffer) =>
    event({ type: "stderr", text: b.toString() }),
  );
  void app.trackWork(
    (async () => {
      const timeout = setTimeout(
        () => {
          killTree("SIGKILL");
        },
        30 * 60 * 1000,
      );
      try {
        if (agent.kind === "cli") {
          if (host.kind === "local") p.stdin.end();
          p.stdout.on("data", (b: Buffer) => {
            run.summary = (run.summary ?? "") + b.toString();
            event({ type: "stdout", text: b.toString() });
            outputBuffer += b.toString();
            let newline;
            while ((newline = outputBuffer.indexOf("\n")) >= 0) {
              const line = outputBuffer.slice(0, newline);
              outputBuffer = outputBuffer.slice(newline + 1);
              try {
                event(JSON.parse(line));
              } catch {}
            }
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
                run.summary = (run.summary ?? "") + params.update.content.text;
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
                  prompt: [{ type: "text", text: prompt }],
                }),
              );
            });
          killTree("SIGTERM");
        }
        run.status = cancelled ? "cancelled" : "done";
      } catch (e) {
        run.status = cancelled ? "cancelled" : "failed";
        event({ type: "error", message: String(e) });
      } finally {
        clearTimeout(timeout);
        killTree("SIGTERM");
        const url = run.summary?.match(
          /https:\/\/[^\s<>"']+\/(?:pull|pulls)\/\d+/,
        )?.[0];
        if (url) run.pullRequestUrl = url;
        if (outputBuffer) {
          try {
            event(JSON.parse(outputBuffer));
          } catch {}
        }
        run.finishedAt = new Date().toISOString();
        save();
        live.delete(id);
      }
    })(),
  );
  return { id };
}
