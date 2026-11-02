import { spawn, type ChildProcess } from "node:child_process";
import { killTree, windows } from "./platform";
import { openCheckpoint } from "./checkpoint";
import type { CommandTiming } from "./git";
import repoWorker from "./generated/repo-worker";
import { discover } from "./git";
import { collectRepo } from "./analyze";
import { readThreads } from "./threads";
const activeWorkers = new Set<ChildProcess>();

export function scan(
  args: string[],
  emit: (value: unknown) => void = console.log,
) {
  const values = (key: string) =>
    args.flatMap((a, i) => (a === key ? [args[i + 1]] : []));
  const host = values("--host")[0] ?? "local";
  const t3 = args.includes("--no-t3")
    ? { roots: [], threads: [], errors: [] }
    : readThreads();
  const repositories = [];
  const errors = [...t3.errors];
  for (const [common, path] of discover([...values("--root"), ...t3.roots])) {
    if (
      values("--repo").length &&
      !values("--repo").some((s) => path.includes(s))
    )
      continue;
    emit({ type: "progress", host, path });
    try {
      repositories.push(
        collectRepo(common, path, args.includes("--fetch"), t3.threads),
      );
    } catch (e) {
      errors.push(`${path}: ${String(e)}`);
    }
  }
  const snapshot = {
    version: 1,
    host,
    finished: new Date().toISOString(),
    repositories,
    errors,
  };
  emit({ type: "snapshot", snapshot });
  return snapshot;
}
export async function scanParallel(
  args: string[],
  emit: (value: unknown) => void = console.log,
) {
  const values = (key: string) =>
    args.flatMap((a, i) => (a === key ? [args[i + 1]] : []));
  const jobs = Math.max(1, Math.min(32, Number(values("--jobs")[0] ?? 4) || 4));
  const host = values("--host")[0] ?? "local";
  const started = Date.now();
  const report = (event: Record<string, unknown>) => {
    const value = { ...event, host, at: new Date().toISOString() };
    console.error(`[scan ${host}] ${JSON.stringify(value)}`);
    emit(value);
  };
  report({ type: "scan-phase", phase: "t3" });
  const t3 = args.includes("--no-t3")
    ? { roots: [], threads: [], errors: [] }
    : readThreads();
  report({ type: "scan-phase", phase: "discovery" });
  const entries = [...discover([...values("--root"), ...t3.roots])].filter(
    ([, p]) =>
      !values("--repo").length || values("--repo").some((s) => p.includes(s)),
  );
  const checkpoint = openCheckpoint(
    { host, entries, fetch: args.includes("--fetch"), t3: !args.includes("--no-t3") },
    values("--checkpoint")[0], !args.includes("--no-resume"),
  );
  checkpoint.save();
  report({ type: "scan-phase", phase: "repositories", total: entries.length, checkpoint: checkpoint.path });
  const repoTimeout = Number(values("--repo-timeout-ms")[0] ?? 600000);
  if (!Number.isFinite(repoTimeout) || repoTimeout <= 0) throw Error("Invalid repository timeout");
  const repositories: ReturnType<typeof collectRepo>[] = [],
    errors = [...t3.errors];
  let next = 0, completed = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, entries.length) }, async () => {
      while (next < entries.length) {
        const [common, path] = entries[next++];
        const repoStarted = Date.now();
        report({ type: "progress", path, completed, total: entries.length });
        try {
          const cached = checkpoint.get(common);
          if (cached) {
            // T3 activity is always read afresh, including when Git results resume.
            const repo = { ...cached, threads: t3.threads.filter((t) =>
              cached.worktrees.some((w) => w.path === t.worktree || w.path === t.projectRoot)) };
            repositories.push(repo);
            report({ type: "repo-complete", path, completed: ++completed, total: entries.length, resumed: true });
            continue;
          }
          const repo = await new Promise<ReturnType<typeof collectRepo>>((resolve, reject) => {
            const p = spawn(process.execPath, ["run", "-"], {
              stdio: ["pipe", "pipe", "pipe"], detached: !windows,
            });
            p.stdout.setEncoding("utf8");
            p.stderr.setEncoding("utf8");
            activeWorkers.add(p);
            let output = "", diagnostics = "", errorTail = "", lastCommand: CommandTiming | undefined;
            let timedOut = false;
            const timer = setTimeout(() => {
              timedOut = true;
              killTree(p.pid, "SIGKILL", () => { p.kill("SIGKILL"); });
            }, repoTimeout);
            const heartbeat = setInterval(() => {
              report({ type: "scan-wait", path, elapsedMs: Date.now() - repoStarted,
                command: lastCommand?.command, args: lastCommand?.args });
            }, 10000);
            const cleanup = () => { clearTimeout(timer); clearInterval(heartbeat); };
            p.on("error", (error) => { cleanup(); reject(error); });
            p.stdin.on("error", () => {});
            p.stdout.on("data", (chunk: string) => { output += chunk.toString(); });
            p.stderr.on("data", (chunk: string) => {
              diagnostics += chunk.toString();
              errorTail = (errorTail + chunk.toString()).slice(-2000);
              let end;
              while ((end = diagnostics.indexOf("\n")) >= 0) {
                const line = diagnostics.slice(0, end);
                diagnostics = diagnostics.slice(end + 1);
                let timing: CommandTiming;
                try { timing = JSON.parse(line); } catch {
                  console.error(`[scan ${host}] ${path}: ${line}`);
                  continue;
                }
                lastCommand = timing;
                if (timing.phase === "finish" && (timing.elapsedMs >= 1000 || timing.code === 125))
                  report({ type: "scan-command", path, ...timing });
              }
            });
            p.on("close", (code) => {
              cleanup();
              activeWorkers.delete(p);
              if (timedOut) reject(Error(`Repository timed out after ${repoTimeout}ms; last command: ${JSON.stringify(lastCommand)}`));
              else if (code) reject(Error(`Repository worker exited ${code}: ${errorTail}`));
              else {
                try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
              }
            });
            p.stdin.end("process.argv[2]=" + JSON.stringify(JSON.stringify([
              common, path, args.includes("--fetch"), t3.threads,
            ])) + ";\n" + repoWorker);
          });
          checkpoint.save(common, repo);
          repositories.push(repo);
          report({ type: "repo-complete", path, completed: ++completed, total: entries.length,
            elapsedMs: Date.now() - repoStarted, branches: repo.branches.length + repo.remoteBranches.length });
        } catch (e) {
          const error = `${path}: ${String(e)}`;
          errors.push(error);
          report({ type: "repo-error", path, error });
        }
      }
    }),
  );
  const snapshot = {
    version: 1,
    host,
    finished: new Date().toISOString(),
    repositories,
    errors,
  };
  report({ type: "scan-phase", phase: "complete", completed, total: entries.length,
    elapsedMs: Date.now() - started, errors: errors.length });
  emit({ type: "snapshot", snapshot });
  if (!errors.length) checkpoint.clear();
  return snapshot;
}
if (import.meta.main) {
  // Repository workers have their own process groups to enforce per-repo budgets.
  const stop = () => {
    for (const p of activeWorkers)
      killTree(p.pid, "SIGKILL", () => { p.kill("SIGKILL"); });
    process.exit(143);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  if (!windows) process.on("SIGHUP", stop);
  await scanParallel(process.argv.slice(2), (v) =>
    console.log(JSON.stringify(v)),
  );
}
