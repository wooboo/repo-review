import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import { scanParallel } from "./main";

test("interrupted delivery preserves completed repositories for the next scan", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-checkpoint-"));
  const checkpoint = join(root, "checkpoint.json");
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Test");
    git(root, "config", "user.email", "test@example.com");
    writeFileSync(join(root, "file"), "test");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    const args = ["--root", root, "--no-fetch", "--no-t3", "--checkpoint", checkpoint];
    await expect(scanParallel(args, (event: any) => {
      if (event.type === "snapshot") throw Error("connection lost");
    })).rejects.toThrow("connection lost");
    expect(existsSync(checkpoint)).toBe(true);
    const events: any[] = [];
    const result = await scanParallel(args, (event) => events.push(event));
    expect(result.repositories).toHaveLength(1);
    expect(events.some((e) => e.type === "repo-complete" && e.resumed)).toBe(true);
    expect(existsSync(checkpoint)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repository time budget fails visibly and retains the checkpoint", async () => {
  const root = mkdtempSync(join(tmpdir(), "review-scan-timeout-"));
  const checkpoint = join(root, "checkpoint.json");
  try {
    git(root, "init", "-b", "main");
    const result = await scanParallel([
      "--root", root, "--no-t3", "--no-fetch", "--checkpoint", checkpoint,
      "--repo-timeout-ms", "1",
    ], () => {});
    expect(result.errors.join(" ")).toContain("timed out");
    expect(result.repositories).toHaveLength(0);
    expect(existsSync(checkpoint)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("expired, invalid and explicitly discarded checkpoints trigger fresh collection", async () => {
  const { openCheckpoint } = await import("./checkpoint");
  const root = mkdtempSync(join(tmpdir(), "review-checkpoint-expiry-"));
  const path = join(root, "checkpoint.json");
  try {
    const common = join(root, ".git");
    git(root, "init", "-b", "main");
    const { collectRepo } = await import("./analyze");
    const repo = collectRepo(common, root, false);
    const checkpoint = openCheckpoint("fixture", path);
    checkpoint.save(common, repo);
    expect(openCheckpoint("fixture", path).get(common)?.path).toBe(root);
    expect(openCheckpoint("different roots", path).get(common)).toBeUndefined();
    expect(openCheckpoint("fixture", path, false).get(common)).toBeUndefined();
    const state = await Bun.file(path).json();
    state.started = Date.now() - 86400001;
    writeFileSync(path, JSON.stringify(state));
    expect(openCheckpoint("fixture", path).get(common)).toBeUndefined();
    writeFileSync(path, "{interrupted write");
    expect(openCheckpoint("fixture", path).get(common)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
