import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Clone } from "../domain/model";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function atomicWrite(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Only unfinished scans are reused, for at most 24 hours. */
export function openCheckpoint(signature: unknown, path?: string, resume = true) {
  const key = hash(signature);
  path ??= join(homedir(), ".cache", "repo-review", `scan-${key}.json`);
  const resultsDir = `${path}.repos`;
  let state: { version: number; key: string; started: number; repositories: Record<string, boolean> } = {
    version: 2, key, started: Date.now(), repositories: {},
  };
  if (resume) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8"));
      if (saved.version === 2 && saved.key === key &&
          typeof saved.started === "number" && saved.started <= Date.now() &&
          Date.now() - saved.started < 86400000 && saved.repositories &&
          typeof saved.repositories === "object" && !Array.isArray(saved.repositories))
        state = saved;
    } catch { /* Missing or invalid checkpoints start a fresh scan. */ }
  }
  const resultPath = (common: string) => join(resultsDir, `${hash(common)}.json`);
  return {
    path,
    get(common: string): Clone | undefined {
      if (state.repositories[common] !== true) return;
      try {
        const repo = JSON.parse(readFileSync(resultPath(common), "utf8"));
        if (repo.commonDir === common && typeof repo.path === "string" &&
            Array.isArray(repo.branches) && Array.isArray(repo.remoteBranches) &&
            Array.isArray(repo.worktrees)) return repo;
      } catch { /* A missing or damaged result is collected again. */ }
    },
    save(common?: string, repo?: Clone) {
      // Write each potentially large result once, then commit the small manifest.
      if (common && repo) {
        atomicWrite(resultPath(common), repo);
        state.repositories[common] = true;
      }
      atomicWrite(path, state);
    },
    clear() {
      rmSync(path, { force: true });
      rmSync(resultsDir, { recursive: true, force: true });
    },
  };
}
