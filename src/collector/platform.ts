// Platform differences between POSIX hosts and Windows, in one place. Bundled
// into the host scripts, so it imports only Node built-ins.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const windows = process.platform === "win32";

/** Expands a leading `~` (with `/` or, on Windows, `\`) and resolves the rest. */
export const expand = (path: string) =>
  path === "~"
    ? homedir()
    : /^~[/\\]/.test(path) && (windows || path[1] === "/")
      ? join(homedir(), path.slice(2))
      : resolve(path);

/** Comparable form of a path: Windows paths are case-insensitive and accept both separators. */
const comparable = (path: string) =>
  windows
    ? resolve(path).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
    : path;

/** True when `path` is `root` or lies below it. */
export function within(path: string, root: string) {
  const p = comparable(path),
    r = comparable(root);
  return p === r || p.startsWith(r.endsWith("/") ? r : r + "/");
}

/** True for `/` and for Windows drive or UNC share roots. */
export const isFilesystemRoot = (path: string) => dirname(path) === path;

/** Quotes one argument for the host's interactive shell (POSIX sh, or PowerShell on Windows). */
export const shellQuote = (s: string) =>
  windows
    ? "'" + s.replaceAll("'", "''") + "'"
    : "'" + s.replaceAll("'", "'\\''") + "'";

/**
 * Working directories of the current user's processes, or `undefined` when they
 * cannot be listed. Windows does not expose other processes' working
 * directories, so it returns none and callers also check `inUse` per path.
 */
export function processCwds(): string[] | undefined {
  if (windows) return [];
  const r = spawnSync(
    "lsof",
    ["-nP", "-a", "-u", String(process.getuid?.() ?? ""), "-d", "cwd", "-Fn"],
    { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 && r.status !== 1) return undefined;
  return r.stdout
    .split("\n")
    .filter((l) => l.startsWith("n/"))
    .map((l) => l.slice(1));
}

const sleep = (ms: number) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Windows only: true when a process holds the directory or anything inside it
 * open (a working directory, an open file). Windows refuses to rename such a
 * directory, so a rename and immediate rename back is a reliable probe. Always
 * false elsewhere, where `processCwds` covers working directories.
 */
export function inUse(path: string) {
  if (!windows || !existsSync(path)) return false;
  const probe = `${path}.repo-review-probe-${process.pid}`;
  try {
    renameSync(path, probe);
  } catch {
    return true;
  }
  for (let attempt = 0; ; attempt++)
    try {
      renameSync(probe, path);
      return false;
    } catch (e) {
      if (attempt >= 50)
        throw Error(`Busy probe could not restore ${path} from ${probe}`, {
          cause: e,
        });
      sleep(100);
    }
}

/** Recursive delete. On Windows, clears read-only attributes first (Git marks objects read-only). */
export function removeTree(path: string) {
  if (windows) {
    const writable = (p: string) => {
      const s = lstatSync(p);
      if (s.isSymbolicLink()) return;
      if (s.isDirectory()) for (const e of readdirSync(p)) writable(join(p, e));
      else chmodSync(p, 0o666);
    };
    if (existsSync(path)) writable(path);
  }
  rmSync(path, { recursive: true, force: true });
}

/** Total size in bytes of the files below `path`, not following symlinks. */
export function treeSize(path: string): number {
  const s = lstatSync(path);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const e of readdirSync(path)) total += treeSize(join(path, e));
  return total;
}

/**
 * `tar` that understands Windows paths: the bsdtar shipped with Windows 10+,
 * not a GNU tar from Git or MSYS on PATH, which reads `C:` as a remote host.
 */
export const tarCommand = windows
  ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
  : "tar";

/** Argv that runs a user-supplied command line through the platform shell. */
export const shellCommand = (command: string) =>
  windows
    ? [process.env.ComSpec ?? "cmd.exe", "/d", "/s", "/c", `"${command}"`]
    : ["sh", "-c", command];

/** Terminates a process and, where possible, its descendants. */
export function killTree(
  pid: number | undefined,
  signal: "SIGTERM" | "SIGKILL",
  fallback: () => void,
) {
  try {
    if (!pid) fallback();
    else if (windows)
      // Windows has no process groups; taskkill /T walks the child tree.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    else process.kill(-pid, signal);
  } catch {
    fallback();
  }
}
