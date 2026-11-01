import {
  LandingListInput,
  CommitProvenanceInput,
  BranchHistoryInput,
  SyncPullRequestsInput,
} from "../domain/model";
import { startJob, getJob } from "./jobs";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";
import { withApp } from "./application";
import {
  ListInput,
  IdInput,
  ScanInput,
  Settings,
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
  cancelRun,
  listAgents as agents,
} from "./agents";
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
export const planActions = createServerFn({ method: "POST" })
  .validator(valid(PlanActionsInput))
  .handler(({ data }) =>
    withApp((a) => startJob(a, "plan-actions", () => a.planActions(data))),
  );
export const listActions = createServerFn({ method: "GET" })
  .validator(valid(ActionListInput))
  .handler(({ data }) => withApp((a) => a.listActions(data)));
export const listAgents = createServerFn({ method: "GET" }).handler(() =>
  withApp((a) => agents(a)),
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
export const listAgentRuns = createServerFn({ method: "GET" })
  .validator(valid(AgentListInput))
  .handler(({ data }) => withApp((a) => listRuns(a, data)));
export const cancelAgentRun = createServerFn({ method: "POST" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => cancelRun(a, data.id)));
export const listPullRequests = createServerFn({ method: "GET" })
  .validator(valid(PullRequestListInput))
  .handler(({ data }) => withApp((a) => a.listPullRequests(data)));
export const getPullRequest = createServerFn({ method: "GET" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => a.getPullRequest(data.id)));
export const refreshPullRequests = createServerFn({ method: "POST" })
  .validator(valid(Schema.Struct({ repo: Schema.optional(Schema.String) })))
  .handler(({ data }) =>
    withApp((a) =>
      startJob(
        a,
        "refresh-pull-requests",
        () => a.refreshPullRequests(data.repo),
        data,
      ),
    ),
  );
export const createPullRequest = createServerFn({ method: "POST" })
  .validator(valid(CreatePullRequestInput))
  .handler(({ data }) => withApp((a) => a.createPullRequest(data)));
export const mergePullRequest = createServerFn({ method: "POST" })
  .validator(valid(MergePullRequestInput))
  .handler(({ data }) => withApp((a) => a.mergePullRequest(data)));
export const closePullRequest = createServerFn({ method: "POST" })
  .validator(valid(IdInput))
  .handler(({ data }) => withApp((a) => a.closePullRequest(data.id)));
export const commentPullRequest = createServerFn({ method: "POST" })
  .validator(valid(Schema.Struct({ id: Schema.String, body: Schema.String })))
  .handler(({ data }) => withApp((a) => a.commentPullRequest(data)));
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

export const listLandings = createServerFn({ method: "GET" })
  .validator(valid(LandingListInput))
  .handler(({ data }) => withApp((a) => a.listLandings(data)));

export const getCommitProvenance = createServerFn({ method: "GET" })
  .validator(valid(CommitProvenanceInput))
  .handler(({ data }) => withApp((a) => a.getCommitProvenance(data)));

export const listBranchHistory = createServerFn({ method: "GET" })
  .validator(valid(BranchHistoryInput))
  .handler(({ data }) => withApp((a) => a.listBranchHistory(data)));

export const syncPullRequests = createServerFn({ method: "POST" })
  .validator(valid(SyncPullRequestsInput))
  .handler(({ data }) =>
    withApp((a) =>
      startJob(a, "sync-pull-requests", () => a.syncPullRequests(data), data),
    ),
  );
