import { json } from "../domain/json";
import type { ApplicationApi } from "./application";
export function startJob(
  app: ApplicationApi,
  kind: string,
  work: () => Promise<unknown>,
) {
  const id = crypto.randomUUID();
  app.db.put("job", id, {
    id,
    kind,
    status: "running",
    started: new Date().toISOString(),
  });
  void Promise.resolve()
    .then(work)
    .then(
      (result) =>
        app.db.put("job", id, {
          id,
          kind,
          status: "done",
          finished: new Date().toISOString(),
          result: json(result),
        }),
      (error) =>
        app.db.put("job", id, {
          id,
          kind,
          status: "failed",
          finished: new Date().toISOString(),
          error: String(error),
        }),
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
    }>("job", id) ?? null
  );
}
