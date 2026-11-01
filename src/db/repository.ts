import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, and } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { records } from "./schema";
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
  return {
    get<T>(kind: string, id: string): T | undefined {
      const row = db
        .select()
        .from(records)
        .where(and(eq(records.kind, kind), eq(records.id, kind + ":" + id)))
        .get();
      return row ? (JSON.parse(row.json) as T) : undefined;
    },
    list<T>(kind: string): T[] {
      return db
        .select()
        .from(records)
        .where(eq(records.kind, kind))
        .all()
        .map((r) => JSON.parse(r.json) as T);
    },
    put(kind: string, id: string, value: unknown, host?: string) {
      db.insert(records)
        .values({
          id: kind + ":" + id,
          kind,
          host,
          json: JSON.stringify(value),
          updated: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: records.id,
          set: {
            json: JSON.stringify(value),
            host,
            updated: new Date().toISOString(),
          },
        })
        .run();
    },
    replaceHost(host: string, clones: readonly { path: string }[]) {
      db.transaction(() => {
        db.delete(records)
          .where(and(eq(records.kind, "clone"), eq(records.host, host)))
          .run();
        for (const c of clones)
          this.put("clone", host + ":" + c.path, { ...c, host }, host);
      });
    },
    close() {
      sqlite.close();
    },
  };
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
