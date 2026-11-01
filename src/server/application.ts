import { subsystemLayers } from "./services";
import { cancelAllRuns } from "./agents";
import * as actions from "./actions";
import * as prs from "./pull-requests";
import { PullRequest, type PlanActionsInput } from "../domain/model";
import { ApplicationError, SettingsError, ScanError } from "./errors";
import { json, type Json } from "../domain/json";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openRepository } from "../db/repository";
import { Snapshot, Settings, PlannedAction } from "../domain/model";
import type { Clone, Host, ListInput } from "../domain/model";
import { searchParams } from "../domain/model";
import { verdict, activeStatus } from "../domain/logic";
import { runHost } from "./hosts";
import { ForgeService } from "./forge";
export type StoredClone = Clone & { host: string };
export type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  started: string;
  finished?: string;
  events: Json[];
  errors: string[];
};
export function makeApplication(path?: string) {
  const db = openRepository(path);
  const defaults: Settings = {
    hosts: [
      {
        id: "local",
        kind: "local",
        enabled: true,
        roots: [
          "Work",
          "Projects",
          ".t3/projects",
          ".t3/worktrees",
          ".codex/worktrees",
        ]
          .filter((p) => existsSync(join(homedir(), p)))
          .map((p) => "~/" + p),
      },
    ],
    forges: [],
    agents: [],
    staleDays: 60,
    worktreeDir: "~/.repo-review/worktrees",
    dailyScanTime: "03:00",
  };
  if (!db.get("settings", "main")) db.put("settings", "main", defaults);
  for (const kind of ["scan", "job", "agent", "action"])
    for (const job of db.list<Job>(kind))
      if (["queued", "running"].includes(job.status))
        db.put(kind, job.id, {
          ...job,
          status: "failed",
          errors: ["Server restarted"],
          error: "Server restarted",
          reason: "Server restarted",
          summary: "Server restarted",
          finishedAt: new Date().toISOString(),
        });
  const background = new Set<Promise<unknown>>();
  const pending = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const settings = () =>
    Schema.decodeUnknownSync(Settings)(db.get("settings", "main"));
  const clones = () => db.list<StoredClone>("clone");
  const branchRows = () => {
    const groups = new Map<
      string,
      { clone: StoredClone; branch: Clone["branches"][number] }[]
    >();
    for (const clone of clones())
      for (const branch of clone.branches) {
        const key = clone.key + "#" + branch.name;
        const group = groups.get(key) ?? [];
        group.push({ clone, branch });
        groups.set(key, group);
      }
    return [...groups].map(([id, rows]) => {
      const flags = rows.map(({ clone, branch }) => ({
        state: branch.state,
        sha: branch.sha,
        unpushed: branch.unpushed,
        dirty: clone.worktrees.some((w) => w.branch === branch.name && w.dirty),
        active:
          clone.threads.some(
            (t) => t.branch === branch.name && activeStatus(t.status),
          ) ||
          db
            .list<{ status: string; branch: string; repo: string }>("agent")
            .some(
              (a) =>
                a.repo === clone.path &&
                a.branch === branch.name &&
                a.status === "running",
            ),
      }));
      return {
        jev: process.env.TYPESAFE_API_KEY
          ? (db
              .list<{
                id: string;
                value: {
                  recommendation:
                    "delete" | "archive" | "keep" | "finish_and_merge";
                  confidence: number;
                  flags: string[];
                };
              }>("classification")
              .find((c) => c.id === id)?.value ?? null)
          : null,
        id,
        name: rows[0].branch.name,
        repo: rows[0].clone.key,
        verdict: verdict(
          flags,
          db
            .list<{
              repo: string;
              head: string;
              state: string;
              headSha: string;
            }>("pull_request")
            .find(
              (pr) =>
                pr.repo === rows[0].clone.key &&
                pr.head === rows[0].branch.name,
            ),
        ),
        dirty: flags.some((f) => f.dirty),
        localOnly: flags.some((f) => f.unpushed > 0),
        stale: rows.every(
          (r) =>
            Date.now() - Date.parse(r.branch.date) >
            settings().staleDays * 86400000,
        ),
        differentShas: new Set(rows.map((r) => r.branch.sha)).size > 1,
        date:
          rows
            .map((r) => r.branch.date)
            .sort()
            .at(-1) ?? "",
        clones: rows.map((r) => ({
          host: r.clone.host,
          path: r.clone.path,
          ...r.branch,
        })),
      };
    });
  };
  const paged = <T extends { name: string; date?: string }>(
    rows: T[],
    input: ListInput,
  ) => {
    const p = searchParams(input);
    const filtered = rows
      .filter(
        (r) =>
          !p.text ||
          JSON.stringify(r).toLowerCase().includes(p.text.toLowerCase()),
      )
      .sort((a, b) =>
        p.sort === "date"
          ? (b.date ?? "").localeCompare(a.date ?? "")
          : a.name.localeCompare(b.name),
      );
    return {
      items: filtered.slice((p.page - 1) * p.pageSize, p.page * p.pageSize),
      total: filtered.length,
      page: p.page,
      pageSize: p.pageSize,
    };
  };
  const api = {
    db,
    trackWork<T>(work: Promise<T>): Promise<T> {
      background.add(work);
      void work.finally(() => background.delete(work)).catch(() => {});
      return work;
    },
    settings,
    updateSettings(value: Settings) {
      const valid = Schema.decodeUnknownSync(Settings)(value);
      if (new Set(valid.hosts.map((h) => h.id)).size !== valid.hosts.length)
        throw new SettingsError({ message: "Duplicate host id" });
      db.put("settings", "main", valid);
      return valid;
    },
    listRepositories(input: ListInput = {}) {
      const selected = clones().filter(
        (c) => !input.host || c.host === input.host,
      );
      const keys = [...new Set(selected.map((c) => c.key))];
      return paged(
        keys.map((key) => ({
          about:
            db
              .list<{
                key: string;
                about: {
                  summary: string;
                  description: string;
                  kind: string;
                  generatedAt: string;
                };
              }>("description")
              .find((d) => d.key === key)?.about ?? null,
          id: key,
          key,
          name: key.split("/").at(-1) ?? key,
          clones: selected.filter((c) => c.key === key).length,
          branches: branchRows().filter((b) => b.repo === key).length,
        })),
        input,
      );
    },
    getRepository(id: string) {
      return {
        about:
          db
            .list<{
              key: string;
              about: {
                summary: string;
                description: string;
                kind: string;
                generatedAt: string;
              };
            }>("description")
            .find((d) => d.key === id)?.about ?? null,
        key: id,
        clones: clones().filter((c) => c.key === id),
        branches: branchRows().filter((b) => b.repo === id),
      };
    },
    searchBranches(input: ListInput = {}) {
      return paged(
        branchRows().filter(
          (b) =>
            (!input.repo || b.repo === input.repo) &&
            (!input.host || b.clones.some((c) => c.host === input.host)) &&
            (!input.verdict || b.verdict === input.verdict) &&
            (!input.state || b.clones.some((c) => c.state === input.state)) &&
            (input.stale === undefined || b.stale === input.stale) &&
            (input.dirty === undefined || b.dirty === input.dirty) &&
            (input.localOnly === undefined || b.localOnly === input.localOnly),
        ),
        input,
      );
    },
    getBranch(id: string) {
      return branchRows().find((b) => b.id === id) ?? null;
    },
    listWorktrees(input: ListInput = {}) {
      return paged(
        clones()
          .filter(
            (c) =>
              (!input.host || c.host === input.host) &&
              (!input.repo || c.key === input.repo),
          )
          .flatMap((c) =>
            c.worktrees.map((w) => ({
              ...w,
              id: c.host + ":" + w.path,
              name: w.path,
              host: c.host,
              repo: c.key,
            })),
          )
          .filter((w) => input.dirty === undefined || w.dirty === input.dirty),
        input,
      );
    },
    dashboard() {
      const branches = branchRows();
      return {
        openPullRequests: db
          .list<PullRequest>("pull_request")
          .filter((p) => p.state === "open").length,
        runningAgentRuns: db
          .list<{ status: string }>("agent")
          .filter((r) => r.status === "running" || r.status === "queued")
          .length,
        lastScan:
          db
            .list<Job>("scan")
            .sort((a, b) => b.started.localeCompare(a.started))[0] ?? null,
        jevEnabled: Boolean(process.env.TYPESAFE_API_KEY),
        repositories: new Set(clones().map((c) => c.key)).size,
        clones: clones().length,
        branches: branches.length,
        verdicts: Object.fromEntries(
          [...new Set(branches.map((b) => b.verdict))].map((v) => [
            v,
            branches.filter((b) => b.verdict === v).length,
          ]),
        ),
        dirtyWorktrees: clones()
          .flatMap((c) => c.worktrees)
          .filter((w) => w.dirty).length,
        runningScans: db
          .list<Job>("scan")
          .filter((j) => ["running", "queued"].includes(j.status)),
      };
    },
    startScan(
      input: { hosts: readonly string[]; fetch: boolean },
      trigger = "ui",
    ) {
      const hosts = settings().hosts.filter(
        (h) => h.enabled && (!input.hosts.length || input.hosts.includes(h.id)),
      );
      if (!hosts.length) throw new ScanError({ message: "No enabled hosts" });
      const job: Job = {
        id: crypto.randomUUID(),
        status: "queued",
        started: new Date().toISOString(),
        events: [],
        errors: [],
      };
      db.put("scan", job.id, {
        ...job,
        trigger,
        hosts: hosts.map((h) => h.id),
        fetch: input.fetch,
      });
      const persist = () =>
        db.put("scan", job.id, {
          ...job,
          trigger,
          hosts: hosts.map((h) => h.id),
          fetch: input.fetch,
        });
      void Promise.all(
        hosts.map((host) => {
          const previous = pending.get(host.id) ?? Promise.resolve();
          const task = previous
            .catch(() => {})
            .then(async () => {
              job.status = "running";
              persist();
              let snapshot: Snapshot | undefined;
              try {
                await runHost(
                  host,
                  "scan",
                  [
                    "--host",
                    host.id,
                    ...host.roots.flatMap((r) => ["--root", r]),
                    input.fetch ? "--fetch" : "--no-fetch",
                  ],
                  (event) => {
                    const e = event as { type: string; snapshot?: unknown };
                    if (e.type === "snapshot")
                      snapshot = Schema.decodeUnknownSync(Snapshot)(e.snapshot);
                    else job.events.push(json(event));
                    persist();
                  },
                );
                if (!snapshot) throw Error("Host returned no snapshot");
                const forge = new ForgeService(settings().forges);
                const resolved = [];
                for (const c of snapshot.repositories) {
                  const identity = await forge.resolveIdentity(c);
                  resolved.push({ ...c, key: identity.key, identity });
                }
                db.replaceHost(host.id, resolved);
                for (const key of new Set(resolved.map((c) => c.key)))
                  if (
                    settings().forges.some((f) => key.startsWith(f.host + "/"))
                  ) {
                    try {
                      await api.refreshPullRequests(key);
                    } catch {
                      job.events.push({ type: "forge-unavailable", repo: key });
                    }
                  }
                job.events.push({
                  type: "host-complete",
                  host: host.id,
                  repositories: resolved.length,
                  errors: [...snapshot.errors],
                });
                persist();
              } catch (e) {
                job.errors.push(String(e));
                persist();
              }
            });
          pending.set(host.id, task);
          return task;
        }),
      ).then(() => {
        job.status = job.errors.length ? "failed" : "done";
        job.finished = new Date().toISOString();
        persist();
      });
      return { id: job.id };
    },
    getScan(id: string) {
      return db.get<Job>("scan", id) ?? null;
    },
    listScans() {
      return db.list<Job>("scan");
    },
    planCleanup(input: ListInput = {}) {
      return actions.planActions(api, { kind: "delete-branch", filter: input });
    },
    planActions(input: typeof PlanActionsInput.Type) {
      return actions.planActions(api, input);
    },
    applyActions(ids: readonly string[]) {
      return actions.applyActions(api, ids);
    },
    listPullRequests(
      input: typeof import("../domain/model").PullRequestListInput.Type = {},
    ) {
      const page = db.page<PullRequest>("pull_request", {
        ...input,
        state: input.state ?? "open",
      });
      return {
        ...page,
        items: page.items.map((p) => Schema.decodeUnknownSync(PullRequest)(p)),
      };
    },
    getPullRequest(id: string) {
      return prs.getPullRequest(api, id);
    },
    createPullRequest(
      input: typeof import("../domain/model").CreatePullRequestInput.Type,
    ) {
      return prs.createPullRequest(api, input);
    },
    mergePullRequest(
      input: typeof import("../domain/model").MergePullRequestInput.Type,
    ) {
      return prs.mutatePullRequest(api, input.id, "merge", {
        ...input,
      }) as Promise<PullRequest>;
    },
    closePullRequest(id: string) {
      return prs.mutatePullRequest(api, id, "close") as Promise<PullRequest>;
    },
    async commentPullRequest(input: { id: string; body: string }) {
      await prs.mutatePullRequest(api, input.id, "comment", {
        body: input.body,
      });
      return { ok: true as const };
    },
    listActions(
      input: typeof import("../domain/model").ActionListInput.Type = {},
    ) {
      const page = db.page<typeof PlannedAction.Type>("action", input);
      return {
        ...page,
        items: page.items.map((a) =>
          Schema.decodeUnknownSync(PlannedAction)(a),
        ),
      };
    },
    refreshPullRequests(key?: string): Promise<PullRequest[]> {
      return prs.refreshPullRequests(api, key);
    },
    forge() {
      return new ForgeService(settings().forges);
    },
    runScheduled(now = new Date()) {
      const day = now.toISOString().slice(0, 10);
      if (process.env.BACKUP_DIR && db.get("schedule", "backup-day") !== day) {
        db.backup(process.env.BACKUP_DIR);
        db.put("schedule", "backup-day", day);
      }
      if (
        now.toTimeString().slice(0, 5) === settings().dailyScanTime &&
        db.get("schedule", "scan-day") !== day
      ) {
        db.put("schedule", "scan-day", day);
        api.startScan({ hosts: [], fetch: true }, "schedule");
      }
    },
    startScheduler() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          api.runScheduled();
        } catch (e) {
          console.error("Scheduled maintenance failed:", String(e));
        }
      }, 30000);
      timer.unref();
    },
    async close() {
      if (timer) clearInterval(timer);
      if (pending.size || background.size)
        await Promise.allSettled([...pending.values(), ...background]);
      db.close();
    },
  };
  return api;
}
export type ApplicationApi = ReturnType<typeof makeApplication>;
export class Application extends Context.Service<Application, ApplicationApi>()(
  "Application",
) {}
export const makeAppRuntime = (path?: string) =>
  ManagedRuntime.make(
    subsystemLayers.pipe(
      Layer.provideMerge(
        Layer.effect(
          Application,
          Effect.acquireRelease(
            Effect.sync(() => {
              const app = makeApplication(path);
              app.startScheduler();
              return app;
            }),
            (app) =>
              Effect.promise(async () => {
                await app.close();
              }),
          ),
        ),
      ),
    ),
  );
export const appRuntime = makeAppRuntime();
export const withApp = <T>(f: (app: ApplicationApi) => Promise<T> | T) =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const app = yield* Application;
      return yield* Effect.tryPromise({
        try: async () => f(app),
        catch: (e) =>
          e instanceof Error ? e : new ApplicationError({ message: String(e) }),
      });
    }),
  );
export const hostById = (hosts: readonly Host[], id: string) =>
  hosts.find((h) => h.id === id);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    cancelAllRuns();
    void appRuntime.dispose().finally(() => process.exit(0));
  });
