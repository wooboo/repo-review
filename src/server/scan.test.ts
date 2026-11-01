import { test, expect } from "bun:test";
import { makeApplication } from "./application";
import { collectRepo } from "../collector/analyze";
import { git } from "../collector/git";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
test("host replacement is atomic and does not erase other hosts", () => {
  const app = makeApplication(":memory:");
  const root = mkdtempSync("/tmp/review-ingest-");
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
