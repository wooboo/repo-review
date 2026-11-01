import { realpathSync } from "node:fs";
import type { Action, ActionResult } from "../domain/model";
import { activeStatus, integrated } from "../domain/logic";
import { analyzeBranch, worktree } from "./analyze";
import { git, out, run, worktreeRows } from "./git";
import { readThreads } from "./threads";
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function execute(
  item: Action,
  apply: boolean,
  options: {
    t3?: boolean;
    cwds?: string[];
    activeBranches?: string[];
    activePaths?: string[];
  } = {},
): ActionResult {
  const restore = `git -C ${quote(item.repo)} branch ${quote(item.branch)} ${quote(item.sha)}`;
  const result = (
    status: ActionResult["status"],
    reason: string,
  ): ActionResult => ({ id: item.id, status, reason, restore });
  try {
    const threads =
      options.t3 === false ? { threads: [], errors: [] } : readThreads();
    if (threads.errors.length)
      return result("blocked", "Cannot verify T3 activity");
    const active = threads.threads.filter((t) => activeStatus(t.status));
    if (
      active.some((t) => t.branch === item.branch) ||
      options.activeBranches?.includes(item.branch)
    )
      return result("skipped", "Branch recorded on active thread");
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
        return result("blocked", "Cannot verify process working directories");
      cwds = r.out
        .split("\n")
        .filter((l) => l.startsWith("n/"))
        .map((l) => l.slice(1));
    }
    const ref = "refs/heads/" + item.branch;
    if (!out(item.repo, "rev-parse", "--verify", ref))
      return result("skipped", "Branch no longer exists");
    if (out(item.repo, "rev-parse", "--verify", ref) !== item.sha)
      return result("blocked", "Branch SHA changed");
    if (
      !item.base ||
      !item.baseSha ||
      git(item.repo, "merge-base", "--is-ancestor", item.baseSha, item.base)
        .code
    )
      return result("blocked", "Base missing or rewritten");
    if (item.state === "base" || item.branch===item.base.replace(/^(origin|upstream)\//,"")) return result("blocked", "Cannot delete base");
    const current = analyzeBranch(
      item.repo,
      item.branch,
      ref,
      [item.base],
      item.base,
      [],
    );
    if (!item.archive && !integrated(current.state))
      return result("blocked", "Branch no longer integrated");
    const rows = worktreeRows(item.repo);
    const mine = rows.filter((r) => r.branch === ref);
    for (const row of mine) {
      const w = worktree(row.worktree, row, row.worktree === rows[0]?.worktree);
      if (w.main) return result("skipped", "Main checkout");
      if (
        !w.exists ||
        w.locked ||
        w.dirty ||
        w.operations.length ||
        w.submodules.length ||
        w.head !== item.sha
      )
        return result(
          "skipped",
          "Worktree missing, locked, dirty, in operation, has submodules or moved HEAD",
        );
      const p = realpathSync(w.path);
      if (
        [
          ...cwds,
          ...active.map((t) => t.worktree ?? ""),
          ...(options.activePaths ?? []),
        ].some((x) => x === p || x.startsWith(p + "/"))
      )
        return result("skipped", "Worktree used by process or agent");
    }
    if (!apply)
      return result(
        "planned",
        item.archive ? "Archive before deleting" : "Revalidated",
      );
    if (item.archive) {
      const archive = `refs/heads/archive/${new Date().toISOString().slice(0, 10)}/${item.branch}`;
      const push = git(
        item.repo,
        "push",
        item.remote,
        `${item.sha}:${archive}`,
      );
      if (push.code) return result("failed", "Archive push failed");
      if (
        out(item.repo, "ls-remote", item.remote, archive).split(/\s+/)[0] !==
        item.sha
      )
        return result("blocked", "Archive verification failed");
    }
    for (const r of mine) {
      if (git(item.repo, "worktree", "remove", r.worktree).code)
        return result("failed", "Worktree removal refused");
    }
    if (git(item.repo, "update-ref", "-d", ref, item.sha).code)
      return result("failed", "Ref deletion refused");
    git(item.repo, "config", "--remove-section", "branch." + item.branch);
    return result("done", "Branch deleted");
  } catch (e) {
    return result("failed", String(e));
  }
}
if (import.meta.main) {
  const payload = JSON.parse(
    Buffer.from(process.argv[2], "base64").toString(),
  ) as { items: Action[]; apply: boolean };
  for (const item of payload.items)
    console.log(
      JSON.stringify({ type: "action", result: execute(item, payload.apply) }),
    );
}
