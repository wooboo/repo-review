import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expand } from "./platform";
export { expand };
export const env = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=15",
};
export function run(
  command: string,
  args: string[],
  input?: string,
  timeout = 120000,
) {
  const r = spawnSync(command, args, {
    env,
    encoding: "utf8",
    input,
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? 125,
    out: r.stdout ?? "",
    error: r.error?.message ?? r.stderr ?? "",
  };
}
export const git = (path: string, ...args: string[]) =>
  run("git", ["-C", path, ...args]);
export function out(path: string, ...args: string[]) {
  const r = git(path, ...args);
  return r.code === 0 ? r.out.trim() : "";
}
export const operations = (dir: string) =>
  [
    "rebase-merge",
    "rebase-apply",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
  ].filter((n) => existsSync(join(dir, n)));
export function worktreeRows(path: string) {
  const r = git(path, "worktree", "list", "--porcelain");
  if (r.code) throw Error("Cannot list worktrees");
  return r.out
    .trim()
    .split("\n\n")
    .map((b) =>
      Object.fromEntries(
        b.split("\n").map((l) => {
          const i = l.indexOf(" ");
          return i < 0 ? [l, "true"] : [l.slice(0, i), l.slice(i + 1)];
        }),
      ),
    );
}
export function discover(roots: readonly string[]) {
  const found = new Map<string, string>();
  const walk = (p: string, d: number) => {
    try {
      if (lstatSync(p).isSymbolicLink()) return;
      if (
        existsSync(join(p, ".git")) ||
        (existsSync(join(p, "HEAD")) && existsSync(join(p, "objects")))
      ) {
        const common = out(
          p,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        );
        if (common) found.set(realpathSync(common), p);
        return;
      }
      if (d <= 0) return;
      for (const e of readdirSync(p, { withFileTypes: true }))
        if (
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          ![
            "node_modules",
            "vendor",
            "dist",
            "build",
            "target",
            "venv",
          ].includes(e.name)
        )
          walk(join(p, e.name), d - 1);
    } catch {
      /* unreadable roots are ignored */
    }
  };
  for (const r of roots) walk(expand(r), r.includes("worktrees") ? 4 : 3);
  return found;
}
