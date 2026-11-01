import { ActionError } from "./errors";
import type { ApplicationApi } from "./application";
import { Schema } from "effect";
import { PlannedAction, type PlanActionsInput } from "../domain/model";
import type { WorkerAction } from "../collector/action-worker";
import { runHost } from "./hosts";
export async function planActions(
  app: ApplicationApi,
  input: typeof PlanActionsInput.Type,
) {
  const branches = input.branchIds
    ? input.branchIds.map((id) => {
        const b = app.getBranch(id);
        if (!b) throw new ActionError({ message: "Branch missing" });
        return b;
      })
    : (() => {
        const filter = {
          ...input.filter,
          ...(input.kind === "delete-branch"
            ? { verdict: "delete" as const }
            : {}),
        };
        const first = app.searchBranches({ ...filter, page: 1, pageSize: 200 });
        const rows = [...first.items];
        for (let page = 2; page <= Math.ceil(first.total / 200); page++)
          rows.push(
            ...app.searchBranches({ ...filter, page, pageSize: 200 }).items,
          );
        return rows;
      })();
  const targets: readonly import("../domain/model").ActionTarget[] =
    input.targets ??
    branches.flatMap((b) =>
      b.clones.map((c) => ({ host: c.host, repo: c.path, branch: b.name })),
    );
  const result: PlannedAction[] = [];
  for (const target of targets) {
    const clone = app.db
      .list<import("./application").StoredClone>("clone")
      .find((c) => c.host === target.host && c.path === target.repo);
    if (!clone) throw new ActionError({ message: "Clone missing" });
    const b = clone.branches.find((b) => b.name === target.branch),
      remote = clone.remotes.find(
        (r) => r.name === (target.remote ?? "origin"),
      );
    const action: WorkerAction = {
      id: crypto.randomUUID(),
      kind: input.kind,
      target,
      branchId: b ? clone.key + "#" + b.name : null,
      repoKey: clone.key,
      status: "planned",
      reason: "",
      restore: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      sha: b?.sha ?? "",
      base: b?.base ?? "",
      baseSha: b?.baseSha ?? "",
      remoteUrl: remote?.url ?? "",
    };
    if (input.kind === "delete-branch" || input.kind === "archive-and-delete") {
      if (!b) throw new ActionError({ message: "Branch missing" });
      action.deletion = {
        id: action.id,
        host: target.host,
        repo: target.repo,
        branch: b.name,
        sha: b.sha,
        base: b.base ?? "",
        baseSha: b.baseSha ?? "",
        state: b.state,
        archive: input.kind === "archive-and-delete",
        remote: target.remote ?? "origin",
      };
    }
    result.push(await runPlanned(app, action, false));
  }
  return result;
}
export async function runPlanned(
  app: ApplicationApi,
  action: WorkerAction,
  apply: boolean,
): Promise<PlannedAction> {
  const host = app.settings().hosts.find((h) => h.id === action.target.host);
  if (!host) throw new ActionError({ message: "Host missing" });
  const active = app.db
    .list<{ repo: string; branchId: string | null; status: string }>("agent")
    .some(
      (r) =>
        r.repo === action.repoKey &&
        r.status === "running" &&
        (!action.branchId || r.branchId === action.branchId),
    );
  if (active) {
    const blocked = {
      ...action,
      status: "blocked" as const,
      reason: "Active agent run",
    };
    app.db.put("action", action.id, blocked);
    return Schema.decodeUnknownSync(PlannedAction)(blocked);
  }
  if (action.deletion) {
    const landed = app
      .getBranch(action.branchId ?? "")
      ?.clones.find(
        (c) => c.host === action.target.host && c.path === action.target.repo,
      )?.landedVia;
    const pr = landed
      ? app.db.get<import("../domain/model").PullRequest>(
          "pull_request",
          landed.pullRequestId,
        )
      : undefined;
    action = {
      ...action,
      deletion: {
        ...action.deletion,
        prEvidence: pr
          ? {
              id: pr.id,
              state: pr.state,
              commits: [pr.headSha, ...app.db.commits(pr.id).map((c) => c.sha)],
            }
          : undefined,
      },
    };
  }
  let result: PlannedAction | undefined;
  await runHost(
    host,
    "worker",
    [
      Buffer.from(JSON.stringify({ items: [action], apply })).toString(
        "base64",
      ),
    ],
    (event) => {
      const e = event as { type: string; result: unknown };
      if (e.type === "action")
        result = Schema.decodeUnknownSync(PlannedAction)(e.result);
    },
  );
  if (!result) throw new ActionError({ message: "Worker returned no result" });
  app.db.put("action", action.id, { ...action, ...result });
  return result;
}
export async function applyActions(
  app: ApplicationApi,
  ids: readonly string[],
) {
  const result: PlannedAction[] = [];
  for (const id of ids) {
    const action = app.db.get<WorkerAction>("action", id);
    if (!action || action.status !== "planned")
      throw new ActionError({ message: "Only planned actions can be applied" });
    app.db.put("action", id, { ...action, status: "running" });
    try {
      result.push(await runPlanned(app, action, true));
    } catch (e) {
      const failed = {
        ...action,
        status: "failed" as const,
        reason: String(e),
        finishedAt: new Date().toISOString(),
      };
      app.db.put("action", id, failed);
      result.push(failed);
    }
  }
  return result;
}
