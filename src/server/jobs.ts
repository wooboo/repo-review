import { ForgeRateLimited } from "./forge-budget";
import { json } from "../domain/json";
import type { ApplicationApi } from "./application";
export function startJob(
  app: ApplicationApi,
  kind: string,
  work: () => Promise<unknown>,
  input: { repo?: string; full?: boolean } = {},
  existingId?: string,
) {
  const id = existingId ?? crypto.randomUUID();
  const started = new Date().toISOString();
  app.db.put("job", id, {
    id,
    kind,
    input,
    status: "running",
    started,
  });
  void app.trackWork(
    Promise.resolve()
      .then(work)
      .then(
        (result) =>
          app.db.put("job", id, {
            id,
            kind,
            started,
            status: "done",
            finished: new Date().toISOString(),
            result: json(
              kind.includes("pull-requests")
                ? {
                    pullRequests: result,
                    forgeBudgets: app.dashboard().forgeBudgets,
                  }
                : result,
            ),
          }),
        (error) =>
          app.db.put("job", id, {
            id,
            kind,
            started,
            input,
            status: error instanceof ForgeRateLimited ? "paused" : "failed",
            finished: new Date().toISOString(),
            error: String(error),
            ...(error instanceof ForgeRateLimited
              ? {
                  errorType: error._tag,
                  retryAt: error.retryAt,
                  result: { forgeBudgets: app.dashboard().forgeBudgets },
                }
              : {}),
          }),
      ),
  );
  return { id };
}
export function getJob(app: ApplicationApi, id: string) {
  return (
    app.db.get<{
      id: string;
      kind: string;
      status: string;
      result?: ReturnType<typeof json>;
      error?: string;
      errorType?: "ForgeRateLimited";
      retryAt?: string;
    }>("job", id) ?? null
  );
}

export function resumeSyncJobs(app: ApplicationApi, now = new Date()) {
  for (const job of app.db.list<{
    id: string;
    kind: string;
    status: string;
    retryAt?: string;
    input?: { repo?: string; full?: boolean };
  }>("job")) {
    if (
      job.status === "paused" &&
      job.retryAt &&
      Date.parse(job.retryAt) <= now.getTime()
    )
      startJob(
        app,
        job.kind,
        () => app.syncPullRequests(job.input),
        job.input,
        job.id,
      );
  }
}
