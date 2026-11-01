import { ApplicationError } from "./errors";
import { json, type Json } from "../domain/json";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openRepository } from "../db/repository";
import { Snapshot, Settings, ActionResult } from "../domain/model";
import type { Clone, Action, Host, ListInput } from "../domain/model";
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
    worktreeDir: join(homedir(), ".repo-review/worktrees"),
    dailyScanTime: "03:00",
  };
  if (!db.get("settings", "main")) db.put("settings", "main", defaults);
  for (const job of db.list<Job>("scan"))
    if (["queued", "running"].includes(job.status))
      db.put("scan", job.id, {
        ...job,
        status: "failed",
        errors: ["Server restarted"],
      });
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
    settings,
    updateSettings(value: Settings) {
      const valid = Schema.decodeUnknownSync(Settings)(value);
      if (new Set(valid.hosts.map((h) => h.id)).size !== valid.hosts.length)
        throw Error("Duplicate host id");
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
      if (!hosts.length) throw Error("No enabled hosts");
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
    async planCleanup(input: ListInput = {}) {
      const results = [];
      const first = api.searchBranches({
        ...input,
        verdict: "delete",
        page: 1,
        pageSize: 200,
      });
      const branches = [...first.items];
      for (let page = 2; page <= Math.ceil(first.total / 200); page++)
        branches.push(
          ...api.searchBranches({
            ...input,
            verdict: "delete",
            page,
            pageSize: 200,
          }).items,
        );
      for (const b of branches)
        for (const c of b.clones) {
          const action: Action = {
            id: crypto.randomUUID(),
            host: c.host,
            repo: c.path,
            branch: b.name,
            sha: c.sha,
            base: c.base ?? "",
            baseSha: c.baseSha ?? "",
            state: c.state,
            archive: false,
            remote: "origin",
          };
          db.put("action", action.id, { ...action, status: "running" });
          results.push(await api.runAction(action, false));
        }
      return results;
    },
    async runAction(action: Action, apply: boolean) {
      if (
        db
          .list<{ repo: string; branch: string; status: string }>("agent")
          .some(
            (r) =>
              r.repo === action.repo &&
              r.branch === action.branch &&
              r.status === "running",
          )
      ) {
        const result = {
          id: action.id,
          status: "blocked" as const,
          reason: "Branch used by active agent run",
          restore: "",
        };
        db.put("action", action.id, { ...action, ...result });
        return result;
      }
      const host = settings().hosts.find((h) => h.id === action.host);
      if (!host) throw Error("Host missing");
      let result: typeof ActionResult.Type | undefined;
      await runHost(
        host,
        "worker",
        [
          Buffer.from(JSON.stringify({ items: [action], apply })).toString(
            "base64",
          ),
        ],
        (event) => {
          const e = event as { type: string; result?: unknown };
          if (e.type === "action")
            result = Schema.decodeUnknownSync(ActionResult)(e.result);
        },
      );
      if (!result) throw Error("Worker returned no result");
      db.put("action", action.id, { ...action, ...result });
      return result;
    },
    async applyActions(ids: readonly string[]) {
      const results = [];
      for (const id of ids) {
        const action = db.get<Action & { status: string }>("action", id);
        if (!action || action.status !== "planned")
          throw Error("Only planned actions can be applied");
        db.put("action", id, { ...action, status: "running" });
        results.push(await api.runAction(action, true));
      }
      return results;
    },
    getActions() {
      return db.list<Action & typeof ActionResult.Type>("action");
    },
    async refreshPullRequests(key: string) {
      const values = (await new ForgeService(
        settings().forges,
      ).listPullRequests(key)) as {
        number: number;
        state: string;
        merged_at?: string;
        head: { ref: string; sha: string };
        [key: string]: unknown;
      }[];
      for (const pr of values)
        db.put("pull_request", key + "#" + pr.number, {
          ...pr,
          repo: key,
          head: pr.head.ref,
          headSha: pr.head.sha,
          state: pr.merged_at ? "merged" : pr.state,
        });
      return values;
    },
    forge() {
      return new ForgeService(settings().forges);
    },
    startScheduler() {
      if (timer) return;
      let last = "";
      timer = setInterval(() => {
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        if (
          now.toTimeString().slice(0, 5) === settings().dailyScanTime &&
          last !== day
        ) {
          last = day;
          api.startScan({ hosts: [], fetch: true }, "schedule");
        }
      }, 30000);
      timer.unref();
    },
    close() {
      if (timer) clearInterval(timer);
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
    Layer.effect(
      Application,
      Effect.acquireRelease(
        Effect.sync(() => {
          const app = makeApplication(path);
          app.startScheduler();
          return app;
        }),
        (app) => Effect.sync(() => app.close()),
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
        catch: (e) => new ApplicationError({ message: String(e) }),
      });
    }),
  );
export const hostById = (hosts: readonly Host[], id: string) =>
  hosts.find((h) => h.id === id);
