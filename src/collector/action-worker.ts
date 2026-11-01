import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Action, PlannedAction } from "../domain/model";
import { git, out, operations, worktreeRows, run } from "./git";
import { worktree } from "./analyze";
import { readThreads } from "./threads";
import { activeStatus } from "../domain/logic";
export type WorkerAction = PlannedAction & {
  sha: string;
  base: string;
  baseSha: string;
  remoteUrl: string;
  deletion?: Action;
  plannedPrunes?: WorkerAction[];
  dependsOn?: string[];
};
export function executeExtra(
  item: WorkerAction,
  apply: boolean,
  options: { t3?: boolean; cwds?: string[] } = {},
) {
  const result = (status: PlannedAction["status"], reason: string) => ({
    ...item,
    status,
    reason,
    finishedAt: apply || status !== "planned" ? new Date().toISOString() : null,
  });
  const { target: t } = item,
    repo = t.repo,
    branch = t.branch ?? "",
    remote = t.remote ?? "origin";
  const checked = (...args: string[]) => {
    const r = git(repo, ...args);
    if (r.code) throw Error(r.error || "Git command refused");
    return r.out.trim();
  };
  try {
    const threads =
      options.t3 === false ? { threads: [], errors: [] } : readThreads();
    if (threads.errors.length)
      return result("blocked", "Cannot verify T3 activity");
    const active = threads.threads.filter((t) => activeStatus(t.status));
    if (
      active.some(
        (a) =>
          (branch && a.branch === branch) ||
          (t.worktree && a.worktree === t.worktree),
      )
    )
      return result("blocked", "Active thread");
    let cwds = options.cwds;
    if (!cwds) {
      const r = run("lsof", [
        "-nP",
        "-a",
        "-u",
        String(process.getuid?.() ?? ""),
        "-d",
        "cwd",
        "-Fn",
      ]);
      if (r.code !== 0 && r.code !== 1)
        return result("blocked", "Cannot verify processes");
      cwds = r.out
        .split("\n")
        .filter((l) => l.startsWith("n/"))
        .map((l) => l.slice(1));
    }
    const rows = worktreeRows(repo);
    const clean = (path: string) => {
      const row = rows.find((r) => r.worktree === path);
      if (!row) throw Error("Worktree not registered");
      const w = worktree(path, row, path === rows[0]?.worktree);
      if (
        !w.exists ||
        w.dirty ||
        w.locked ||
        w.operations.length ||
        w.submodules.length
      )
        throw Error("Worktree missing, dirty, locked or in operation");
      const canonical = realpathSync(path);
      const used = [
        ...cwds!,
        ...active.flatMap((t) => [t.worktree ?? "", t.projectRoot ?? ""]),
      ]
        .filter(Boolean)
        .map((p) => {
          try {
            return realpathSync(p);
          } catch {
            return p;
          }
        });
      if (used.some((p) => p === canonical || p.startsWith(canonical + "/")))
        throw Error("Worktree used by a process");
    };
    if (
      branch &&
      checked("rev-parse", "--verify", "refs/heads/" + branch) !== item.sha
    )
      return result("blocked", "Branch SHA changed");
    if (item.kind === "prune-worktree") {
      if (!t.worktree || existsSync(t.worktree))
        return result("blocked", "Worktree still exists or missing target");
      const row = rows.find((r) => r.worktree === t.worktree);
      if (!row || row.locked)
        return result("blocked", "Worktree missing or locked");
      const common = checked(
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      );
      const admin = readdirSync(join(common, "worktrees"))
        .map((n) => join(common, "worktrees", n))
        .find(
          (p) =>
            resolve(readFileSync(join(p, "gitdir"), "utf8").trim()) ===
            join(t.worktree!, ".git"),
        );
      if (!admin) return result("blocked", "Cannot locate worktree index");
      const diff = run("git", [
        "--git-dir=" + admin,
        "diff",
        "--cached",
        "--ita-visible-in-index",
        "--quiet",
        "HEAD",
        "--",
      ]);
      if (diff.code !== 0 || operations(admin).length)
        return result(
          "blocked",
          "Missing worktree has staged changes or active operation",
        );
      // Prune is global: refuse if any other missing registration is present.
      if (
        rows.some((r) => r.worktree !== t.worktree && !existsSync(r.worktree))
      )
        return result(
          "blocked",
          "Other missing worktrees need separate verification",
        );
      if (apply) checked("worktree", "prune", "--expire=now");
    } else if (item.kind === "switch-to-base") {
      const path =
        t.worktree ??
        rows.find((r) => r.branch === "refs/heads/" + branch)?.worktree;
      if (!path) throw Error("Branch is not checked out");
      clean(path);
      if (out(path, "rev-parse", "HEAD") !== item.sha)
        throw Error("Checkout moved");
      const base = item.base.replace(/^[^/]+\//, "");
      if (
        !base ||
        out(repo, "rev-parse", "refs/heads/" + base) !== item.baseSha
      )
        throw Error("Base SHA changed");
      const holder = rows.find(
        (r) => r.branch === "refs/heads/" + base && r.worktree !== path,
      );
      if (holder) {
        clean(holder.worktree);
        if (out(holder.worktree, "rev-parse", "HEAD") !== item.baseSha)
          throw Error("Base checkout moved");
      }
      if (apply) {
        if (
          holder &&
          git(holder.worktree, "switch", "--detach", item.baseSha).code
        )
          throw Error("Cannot detach base checkout");
        if (git(path, "switch", base).code)
          throw Error("Cannot switch checkout");
      }
    } else if (item.kind === "fast-forward-base") {
      if (!item.baseSha || out(repo, "rev-parse", item.base) !== item.baseSha)
        throw Error("Base SHA changed");
      if (git(repo, "merge-base", "--is-ancestor", item.sha, item.baseSha).code)
        throw Error("Not a fast forward");
      const holders = rows.filter((r) => r.branch === "refs/heads/" + branch);
      for (const h of holders) clean(h.worktree);
      if (apply) {
        if (holders.length) {
          if (git(holders[0].worktree, "merge", "--ff-only", item.baseSha).code)
            throw Error("Fast forward refused");
        } else
          checked("update-ref", "refs/heads/" + branch, item.baseSha, item.sha);
      }
    } else if (item.kind === "push-branch") {
      if (checked("remote", "get-url", remote) !== item.remoteUrl)
        throw Error("Remote URL changed");
      const upstream = checked(
        "ls-remote",
        remote,
        "refs/heads/" + branch,
      ).split(/\s/)[0];
      if (
        upstream &&
        git(repo, "merge-base", "--is-ancestor", upstream, item.sha).code
      )
        throw Error("Remote is not an ancestor; fetch and review first");
      if (apply) checked("push", remote, item.sha + ":refs/heads/" + branch);
    } else if (item.kind === "set-remote-url") {
      if (!t.url || t.url.startsWith("-") || /[\r\n]/.test(t.url))
        throw Error("Invalid remote URL");
      if (checked("remote", "get-url", remote) !== item.remoteUrl)
        throw Error("Remote URL changed");
      if (apply) checked("remote", "set-url", remote, t.url);
    } else throw Error("Unsupported action");
    return result(
      apply ? "done" : "planned",
      apply ? "Completed" : "Revalidated",
    );
  } catch (e) {
    return result("blocked", String(e));
  }
}
