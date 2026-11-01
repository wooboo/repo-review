import { Context, Effect, Layer } from "effect";
import { Application, type ApplicationApi } from "./application";
import { Repository } from "../db/repository";
import { runHost } from "./hosts";
import { listAgents, startRun, getRun, listRuns, cancelRun } from "./agents";
import { describe, classify } from "./classify";
export {
  HostError,
  ScanError,
  ActionError,
  AgentError,
  DescribeError,
  JevError,
  SettingsError,
  DbError,
} from "./errors";
export class HostRunner extends Context.Service<
  HostRunner,
  { run: typeof runHost }
>()("HostRunner") {}
export class Scan extends Context.Service<
  Scan,
  Pick<ApplicationApi, "startScan" | "getScan" | "listScans">
>()("Scan") {}
export class Actions extends Context.Service<
  Actions,
  Pick<ApplicationApi, "planActions" | "applyActions">
>()("Actions") {}
export class Forge extends Context.Service<
  Forge,
  Pick<
    ApplicationApi,
    | "listPullRequests"
    | "getPullRequest"
    | "createPullRequest"
    | "mergePullRequest"
    | "closePullRequest"
    | "commentPullRequest"
    | "refreshPullRequests"
  >
>()("Forge") {}
export class Agents extends Context.Service<
  Agents,
  {
    list: () => ReturnType<typeof listAgents>;
    start: (
      input: Parameters<typeof startRun>[1],
    ) => ReturnType<typeof startRun>;
    get: (id: string, cursor?: number) => ReturnType<typeof getRun>;
    runs: (
      input?: Parameters<typeof listRuns>[1],
    ) => ReturnType<typeof listRuns>;
    cancel: (id: string) => ReturnType<typeof cancelRun>;
  }
>()("Agents") {}
export class Describe extends Context.Service<
  Describe,
  { describe: (id: string) => ReturnType<typeof describe> }
>()("Describe") {}
export class Jev extends Context.Service<
  Jev,
  { classify: (id: string) => ReturnType<typeof classify> }
>()("Jev") {}
export class SettingsService extends Context.Service<
  SettingsService,
  Pick<ApplicationApi, "settings" | "updateSettings">
>()("Settings") {}
const appService = <T>(f: (a: ApplicationApi) => T) =>
  Effect.gen(function* () {
    return f(yield* Application);
  });
export const subsystemLayers = Layer.mergeAll(
  Layer.succeed(HostRunner, { run: runHost }),
  Layer.effect(
    Repository,
    appService((a) => a.db),
  ),
  Layer.effect(
    Scan,
    appService((a) => ({
      startScan: a.startScan,
      getScan: a.getScan,
      listScans: a.listScans,
    })),
  ),
  Layer.effect(
    Actions,
    appService((a) => ({
      planActions: a.planActions,
      applyActions: a.applyActions,
    })),
  ),
  Layer.effect(
    Forge,
    appService((a) => ({
      listPullRequests: a.listPullRequests,
      getPullRequest: a.getPullRequest,
      createPullRequest: a.createPullRequest,
      mergePullRequest: a.mergePullRequest,
      closePullRequest: a.closePullRequest,
      commentPullRequest: a.commentPullRequest,
      refreshPullRequests: a.refreshPullRequests,
    })),
  ),
  Layer.effect(
    Agents,
    appService((a) => ({
      list: () => listAgents(a),
      start: (input) => startRun(a, input),
      get: (id, cursor) => getRun(a, id, cursor),
      runs: (input) => listRuns(a, input),
      cancel: (id) => cancelRun(a, id),
    })),
  ),
  Layer.effect(
    Describe,
    appService((a) => ({ describe: (id) => describe(a, id) })),
  ),
  Layer.effect(
    Jev,
    appService((a) => ({ classify: (id) => classify(a, id) })),
  ),
  Layer.effect(
    SettingsService,
    appService((a) => ({
      settings: a.settings,
      updateSettings: a.updateSettings,
    })),
  ),
);
