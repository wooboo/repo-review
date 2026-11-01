import { startJob, getJob } from "./jobs";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { withApp } from "./application";
import { ListInput, IdInput, ScanInput, Settings } from "../domain/model";
import { AgentRunInput, startRun, getRun, listRuns, cancelRun } from "./agents";
import { describe, classify } from "./classify";
const valid = <S extends Schema.ConstraintDecoder<unknown>>(s: S) =>
  Schema.toStandardSchemaV1(s);
export const getDashboard = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => a.dashboard()),
);
export const listRepositories = createServerFn({ method: "GET" })
  .validator(valid(ListInput))
  .handler(({ data }) => withApp((a) => a.listRepositories(data)));
export const getRepository = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => a.getRepository(data.id)));
export const searchBranches = createServerFn({ method: "GET" })
  .validator(valid(ListInput))
  .handler(({ data }) => withApp((a) => a.searchBranches(data)));
export const getBranch = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => a.getBranch(data.id)));
export const listWorktrees = createServerFn({ method: "GET" })
  .validator(valid(ListInput))
  .handler(({ data }) => withApp((a) => a.listWorktrees(data)));
export const startScan = createServerFn({ method: "POST" })
  .validator(valid(ScanInput))
  .handler(({ data }) => withApp((a) => a.startScan(data)));
export const getScan = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => a.getScan(data.id)));
export const listScans = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => a.listScans()),
);
export const getSettings = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => a.settings()),
);
export const updateSettings = createServerFn({ method: "POST" })
  .validator(valid(Settings))
  .handler(({ data }) => withApp((a) => a.updateSettings(data)));
export const planCleanup = createServerFn({ method: "POST" })
  .validator(valid(ListInput))
  .handler(({ data }) =>
    withApp((a) => startJob(a, "cleanup-plan", () => a.planCleanup(data))),
  );
export const applyActions = createServerFn({ method: "POST" })
  .validator(valid(Schema.Struct({ ids: Schema.Array(Schema.String) })))
  .handler(({ data }) =>
    withApp((a) =>
      startJob(a, "apply-actions", () => a.applyActions(data.ids)),
    ),
  );
export const listActions = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => a.getActions()),
);
export const startAgentRun = createServerFn({ method: "POST" })
  .validator(valid(AgentRunInput))
  .handler(({ data }) => withApp((a) => startRun(a, data)));
export const getAgentRun = createServerFn({ method: "GET" })
  .validator(
    valid(
      Schema.Struct({
        id: Schema.String,
        cursor: Schema.optional(Schema.Number),
      }),
    ),
  )
  .handler(({ data }) => withApp((a) => getRun(a, data.id, data.cursor)));
export const listAgentRuns = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => listRuns(a)),
);
export const cancelAgentRun = createServerFn({ method: "POST" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => cancelRun(a, data.id)));
// Forge responses retain their upstream JSON shape, wrapped for Start's serializer.
export const listPullRequests = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) =>
    withApp(async (a) => ({
      json: JSON.stringify(await a.refreshPullRequests(data.id)),
    })),
  );
export const getPullRequest = createServerFn({ method: "GET" })
  .validator(
    valid(Schema.Struct({ repo: Schema.String, number: Schema.Number })),
  )
  .handler(({ data }) =>
    withApp(async (a) => ({
      json: JSON.stringify(await a.forge().detail(data.repo, data.number)),
    })),
  );
export const forgeOperation = createServerFn({ method: "POST" })
  .validator(
    valid(
      Schema.Struct({
        repo: Schema.String,
        operation: Schema.Literals([
          "create",
          "merge",
          "close",
          "comment",
          "metadata",
          "search",
          "create-repository",
        ]),
        json: Schema.String,
      }),
    ),
  )
  .handler(({ data }) =>
    withApp(async (a) => ({
      json: JSON.stringify(
        await a
          .forge()
          .operation(
            data.repo,
            data.operation,
            JSON.parse(data.json) as Record<string, unknown>,
          ),
      ),
    })),
  );
export const describeRepository = createServerFn({ method: "POST" })
  .validator(valid(IdInput))
  .handler(({ data }) =>
    withApp((a) => startJob(a, "describe", () => describe(a, data.id))),
  );
export const classifyBranch = createServerFn({ method: "POST" })
  .validator(valid(IdInput))
  .handler(({ data }) =>
    withApp((a) => startJob(a, "classify", () => classify(a, data.id))),
  );

export const getBackgroundJob = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => getJob(a, data.id)));
