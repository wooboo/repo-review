import { DbError } from "../server/errors";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, and, desc, count, like, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import * as tables from "./schema";
import { emitChange } from "../server/events";
const kinds: Record<string, typeof tables.clones> = {
  branch_history: tables.branchHistory,
  provenance: tables.provenance,
  landing: tables.landings,
  repository: tables.repositories,
  clone: tables.clones,
  branch: tables.branches,
  branch_clone: tables.branchClones,
  remote_branch: tables.remoteBranches,
  worktree: tables.worktrees,
  worktree_file: tables.worktreeFiles,
  stash: tables.stashes,
  pull_request: tables.pullRequests,
  action: tables.actions,
  agent: tables.agentRuns,
  agent_event: tables.agentRunEvents,
  scan: tables.scans,
  job: tables.jobs,
  description: tables.descriptions,
  classification: tables.classifications,
  settings: tables.settings,
  schedule: tables.settings,
};
export function openRepository(
  path = process.env.DATABASE_PATH ?? "./data/repo-review.db",
) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  const db = drizzle(sqlite);
  migrate(db, {
    migrationsFolder: existsSync("./src/db/migrations")
      ? "./src/db/migrations"
      : "./.output/server/migrations",
  });
  const table = (kind: string) => {
    const t = kinds[kind];
    if (!t) throw Error("Unknown entity " + kind);
    return t;
  };
  const api = {
    commits(id: string): import("../domain/model").PullRequestCommit[] {
      return sqlite
        .query(
          "SELECT sha, subject, author, at FROM pull_request_commits WHERE pr_id=? ORDER BY position",
        )
        .all(
          "pull_request:" + id,
        ) as import("../domain/model").PullRequestCommit[];
    },
    putCommits(
      id: string,
      commits: readonly import("../domain/model").PullRequestCommit[],
    ) {
      sqlite.transaction(() => {
        sqlite
          .query("DELETE FROM pull_request_commits WHERE pr_id=?")
          .run("pull_request:" + id);
        const insert = sqlite.query(
          "INSERT INTO pull_request_commits VALUES (?,?,?,?,?,?)",
        );
        commits.forEach((c, i) =>
          insert.run("pull_request:" + id, c.sha, i, c.subject, c.author, c.at),
        );
      })();
    },
    get<T>(kind: string, id: string): T | undefined {
      const t = table(kind),
        r = db
          .select()
          .from(t)
          .where(eq(t.id, kind + ":" + id))
          .get();
      return r ? (JSON.parse(r.json) as T) : undefined;
    },
    list<T>(kind: string): T[] {
      return db
        .select()
        .from(table(kind))
        .all()
        .filter((r) => r.id.startsWith(kind + ":"))
        .map((r) => JSON.parse(r.json) as T);
    },
    page<T>(
      kind: string,
      input: {
        repo?: string;
        status?: string;
        state?: string;
        text?: string;
        checks?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const t = table(kind),
        page = Math.max(1, Math.floor(input.page ?? 1)),
        pageSize = Math.max(1, Math.min(200, Math.floor(input.pageSize ?? 50)));
      const where = and(
        like(t.id, kind + ":%"),
        input.repo ? eq(t.repo, input.repo) : undefined,
        input.status ? eq(t.status, input.status) : undefined,
        input.state && input.state !== "all"
          ? eq(t.state, input.state)
          : undefined,
        input.checks
          ? sql`json_extract(${t.json}, '$.checks.state') = ${input.checks}`
          : undefined,
        input.text
          ? sql`instr(lower(${t.json}), lower(${input.text})) > 0`
          : undefined,
      );
      return {
        items: db
          .select()
          .from(t)
          .where(where)
          .orderBy(desc(t.updated), desc(t.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
          .all()
          .map((r) => JSON.parse(r.json) as T),
        total: db.select({ n: count() }).from(t).where(where).get()!.n,
        page,
        pageSize,
      };
    },
    put(kind: string, id: string, value: unknown, host?: string) {
      const t = table(kind),
        v = value as Record<string, unknown>;
      const repo = String(v?.repoKey ?? v?.repo ?? v?.key ?? "");
      const row = {
        repositoryId:
          kind !== "repository" && api.get("repository", repo)
            ? "repository:" + repo
            : null,
        cloneId: typeof v?.cloneId === "string" ? "clone:" + v.cloneId : null,
        branchId:
          kind === "branch_clone" && typeof v?.name === "string"
            ? "branch:" + repo + "#" + v.name
            : null,
        worktreeId:
          typeof v?.worktreeId === "string" ? "worktree:" + v.worktreeId : null,
        id: kind + ":" + id,
        host: host ?? (typeof v?.host === "string" ? v.host : null),
        repo: String(v?.repoKey ?? v?.repo ?? v?.key ?? ""),
        status: typeof v?.status === "string" ? v.status : null,
        state: typeof v?.state === "string" ? v.state : null,
        name: String(v?.name ?? v?.title ?? ""),
        number: typeof v.number === "number" ? v.number : null,
        headRef: typeof v.head === "string" ? v.head : null,
        headSha: typeof v.headSha === "string" ? v.headSha : null,
        mergeCommitSha:
          typeof v.mergeCommitSha === "string" ? v.mergeCommitSha : null,
        mergeMethod: typeof v.mergeMethod === "string" ? v.mergeMethod : null,
        base: typeof v.base === "string" ? v.base : null,
        mergedAt: typeof v.mergedAt === "string" ? v.mergedAt : null,
        verdict: typeof v.verdict === "string" ? v.verdict : null,
        lastCommitAt: String(v.date ?? ""),
        stale: v.stale == null ? null : Number(v.stale),
        dirty: v.dirty == null ? null : Number(v.dirty),
        localOnly: v.localOnly == null ? null : Number(v.localOnly),
        json: JSON.stringify(value),
        updated: String(
          v?.updatedAt ??
            v?.createdAt ??
            v?.startedAt ??
            new Date().toISOString(),
        ),
      };
      db.insert(t)
        .values(row)
        .onConflictDoUpdate({ target: t.id, set: row })
        .run();
      if (kind === "branch_history")
        sqlite
          .query(
            "UPDATE branch_history SET clone_path=?,branch=?,sha=?,first_seen=?,last_seen=?,gone_at=? WHERE id=?",
          )
          .run(
            String(v.clonePath),
            String(v.branch),
            String(v.sha),
            String(v.firstSeen),
            String(v.lastSeen),
            v.goneAt == null ? null : String(v.goneAt),
            row.id,
          );
      const type =
        kind === "scan"
          ? "scan"
          : kind === "job"
            ? "job"
            : kind === "agent" || kind === "agent_event"
              ? "agent-run"
              : "inventory";
      if (["scan", "job", "agent", "agent_event"].includes(kind))
        emitChange({ type, id: kind === "agent_event" ? String(v.runId) : id });
      else if (["description", "classification", "settings"].includes(kind))
        emitChange({ type: "inventory", id: repo || kind });
    },
    replaceHost(host: string, clones: readonly { path: string }[]) {
      db.transaction(() => {
        const now = new Date().toISOString();
        const seen = new Set<string>();
        for (const value of clones) {
          const c = value as import("../domain/model").Clone;
          for (const b of c.branches) {
            const id = JSON.stringify([host, c.path, b.name, b.sha]);
            seen.add(id);
            const old = api.get<import("../domain/model").BranchHistoryItem>(
              "branch_history",
              id,
            );
            api.put("branch_history", id, {
              host,
              repo: c.key,
              clonePath: c.path,
              branch: b.name,
              sha: b.sha,
              firstSeen: old?.firstSeen ?? now,
              lastSeen: now,
              goneAt: null,
              landedVia: old?.landedVia ?? null,
            });
          }
        }
        for (const old of api.list<import("../domain/model").BranchHistoryItem>(
          "branch_history",
        )) {
          const id = JSON.stringify([
            old.host,
            old.clonePath,
            old.branch,
            old.sha,
          ]);
          if (old.host === host && !seen.has(id) && !old.goneAt)
            api.put("branch_history", id, { ...old, goneAt: now });
        }
        for (const kind of [
          "worktree_file",
          "branch_clone",
          "remote_branch",
          "worktree",
          "stash",
          "clone",
        ]) {
          const t = table(kind);
          db.delete(t).where(eq(t.host, host)).run();
        }
        for (const value of clones) {
          const c = value as import("../domain/model").Clone;
          const id = host + ":" + c.path;
          api.put("repository", c.key, { key: c.key, name: c.name });
          api.put(
            "clone",
            id,
            {
              ...c,
              id,
              host,
              worktrees: c.worktrees.map((w) => ({
                ...w,
                missing: !w.exists,
                dirty: w.exists && w.dirty,
              })),
            },
            host,
          );
          for (const b of c.branches) {
            api.put("branch", c.key + "#" + b.name, {
              repo: c.key,
              name: b.name,
            });
            api.put(
              "branch_clone",
              id + "#" + b.name,
              { ...b, repo: c.key, cloneId: id },
              host,
            );
          }
          for (const b of c.remoteBranches)
            api.put(
              "remote_branch",
              id + "#" + b.name,
              { ...b, repo: c.key, cloneId: id },
              host,
            );
          for (const w of c.worktrees) {
            api.put(
              "worktree",
              host + ":" + w.path,
              { ...w, repo: c.key, cloneId: id },
              host,
            );
            for (const f of w.files)
              api.put(
                "worktree_file",
                host + ":" + w.path + ":" + f.path,
                { ...f, worktreeId: host + ":" + w.path, repo: c.key },
                host,
              );
          }
          c.stashes.forEach((s, i) =>
            api.put(
              "stash",
              id + ":" + i,
              { value: s, repo: c.key, cloneId: id },
              host,
            ),
          );
        }
      });
      emitChange({ type: "inventory", id: host });
    },
    backup(dir: string) {
      mkdirSync(dir, { recursive: true });
      const destination = join(
        dir,
        "repo-review-" +
          new Date().toISOString().replaceAll(":", "-") +
          "-" +
          crypto.randomUUID() +
          ".db",
      );
      sqlite.query("VACUUM INTO ?").run(destination);
      const copies = readdirSync(dir)
        .filter((p) => /^repo-review-.*\.db$/.test(p))
        .sort()
        .reverse();
      for (const p of copies.slice(14)) unlinkSync(join(dir, p));
      return destination;
    },
    close() {
      sqlite.close();
    },
  };
  return new Proxy(api, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          return Reflect.apply(value, target, args);
        } catch (e) {
          throw new DbError({ message: String(e) });
        }
      };
    },
  });
}
export class Repository extends Context.Service<
  Repository,
  ReturnType<typeof openRepository>
>()("Repository") {}
export const repositoryLayer = (path?: string) =>
  Layer.effect(
    Repository,
    Effect.sync(() => openRepository(path)),
  );
