import { test, expect } from "bun:test";
import { makeApplication } from "./application";
import { collectRepo } from "../collector/analyze";
import { git } from "../collector/git";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("host replacement is atomic and does not erase other hosts", () => {
  const app = makeApplication(":memory:");
  const root = mkdtempSync(join(tmpdir(), "review-ingest-"));
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
    writeFileSync(root + "/README.md", "Test");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    const c = collectRepo(root + "/.git", root, false);
    app.db.replaceHost("first", [c]);
    app.db.replaceHost("second", [c]);
    expect(app.dashboard().clones).toBe(2);
    app.db.replaceHost("first", []);
    expect(app.dashboard().clones).toBe(1);
    expect(app.listRepositories({ host: "second" }).total).toBe(1);
  } finally {
    app.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T3 project roots belong to one local host, not every local host", async () => {
  const { Database } = await import("bun:sqlite");
  const { mkdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "review-t3-host-"));
  const home = root + "/home",
    repo = root + "/project",
    empty = root + "/empty";
  mkdirSync(home + "/.t3/userdata", { recursive: true });
  mkdirSync(repo);
  mkdirSync(empty);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.com");
  writeFileSync(repo + "/file", "fixture");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fixture");
  const d = new Database(home + "/.t3/userdata/statev2.sqlite");
  d.exec(
    "CREATE TABLE projection_projects(project_id TEXT,workspace_root TEXT,deleted_at TEXT);CREATE TABLE orchestration_v2_projection_runs(thread_id TEXT,status TEXT,ordinal INTEGER);CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT,payload_json TEXT);",
  );
  d.query("INSERT INTO projection_projects VALUES (?,?,NULL)").run(
    "fixture",
    repo,
  );
  d.close();
  const previous = process.env.HOME;
  process.env.HOME = home;
  const app = makeApplication(":memory:");
  try {
    app.updateSettings({
      ...app.settings(),
      hosts: ["one", "two"].map((id) => ({
        id,
        kind: "local" as const,
        roots: [empty],
        enabled: true,
        bun: process.execPath,
      })),
    });
    const { id } = app.startScan({ hosts: [], fetch: false });
    for (
      let i = 0;
      i < 100 && ["queued", "running"].includes(app.getScan(id)!.status);
      i++
    )
      await Bun.sleep(50);
    expect(app.getScan(id)?.errors).toEqual([]);
    expect(app.getScan(id)?.status).toBe("done");
    expect(app.listRepositories({ host: "one" }).total).toBe(1);
    expect(app.listRepositories({ host: "two" }).total).toBe(0);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
