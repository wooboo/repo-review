import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, out, run } from "./git";
import { analyzeBranch, collectRepo } from "./analyze";
import { execute } from "./worker";
import type { Action } from "../domain/model";
const dirs: string[] = [];
afterEach(() => {
  for (const p of dirs.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const p = mkdtempSync(join(tmpdir(), "review-test-"));
  dirs.push(p);
  git(p, "init", "-b", "main");
  git(p, "config", "user.name", "Test");
  git(p, "config", "user.email", "test@example.com");
  writeFileSync(join(p, "file"), "root\n");
  git(p, "add", ".");
  git(p, "commit", "-m", "root");
  return p;
}
function commit(p: string, file: string, value: string) {
  writeFileSync(join(p, file), value);
  git(p, "add", ".");
  const r = git(p, "commit", "-m", value.trim());
  expect(r.code).toBe(0);
}
const analyze = (p: string, n = "feature") =>
  analyzeBranch(p, n, "refs/heads/" + n, ["main"], "main", ["main"]);
const action = (p: string): Action => ({
  id: "a",
  host: "local",
  repo: p,
  branch: "feature",
  sha: out(p, "rev-parse", "feature"),
  base: "main",
  baseSha: out(p, "rev-parse", "main"),
  state: analyze(p).state,
  archive: false,
  remote: "origin",
});
const safe = { t3: false, cwds: [] };
test("fast-forward and divergent ahead/behind", () => {
  const p = fixture();
  git(p, "checkout", "-b", "feature");
  commit(p, "file", "feature\n");
  git(p, "checkout", "main");
  commit(p, "other", "base\n");
  expect(analyze(p)).toMatchObject({ state: "unmerged", ahead: 1, behind: 1 });
  git(p, "merge", "feature", "--no-edit");
  expect(analyze(p).state).toBe("merged");
});
test("cherry-pick is patch merged", () => {
  const p = fixture();
  git(p, "checkout", "-b", "feature");
  commit(p, "file", "feature\n");
  git(p, "checkout", "main");
  commit(p, "other", "different\n");
  git(p, "cherry-pick", "feature");
  expect(analyze(p).state).toBe("patch-merged");
});
test("squash matches full diff and rejects subset of a larger base patch", () => {
  const p = fixture();
  git(p, "checkout", "-b", "feature");
  commit(p, "file", "one\n");
  commit(p, "second", "two\n");
  git(p, "checkout", "main");
  git(p, "merge", "--squash", "feature");
  git(p, "commit", "-m", "squash");
  expect(analyze(p).state).toBe("squash-merged");
  git(p, "reset", "--hard", "HEAD~1");
  git(p, "merge", "--squash", "feature");
  commit(p, "extra", "extra\n");
  expect(analyze(p).state).toBe("content-in-base");
});
test("contained branch and dirty file inventory", () => {
  const p = fixture();
  git(p, "checkout", "-b", "feature");
  commit(p, "file", "one\n");
  git(p, "checkout", "-b", "stack");
  commit(p, "stack", "two\n");
  git(p, "checkout", "main");
  writeFileSync(join(p, "untracked"), "x");
  writeFileSync(join(p, "file"), "changed");
  const c = collectRepo(join(p, ".git"), p, false);
  expect(c.branches.find((b) => b.name === "feature")?.containedIn).toContain(
    "stack",
  );
  expect(c.worktrees[0].files.map((f) => f.path).sort()).toEqual([
    "file",
    "untracked",
  ]);
  expect(c.worktrees[0].dirty).toBe(true);
});
test("plan does not delete; apply uses reviewed SHA", () => {
  const p = fixture();
  git(p, "branch", "feature");
  const a = action(p);
  expect(execute(a, false, safe).status).toBe("planned");
  expect(out(p, "rev-parse", "feature")).toBe(a.sha);
  expect(execute(a, true, safe).status).toBe("done");
  expect(out(p, "show-ref", "--verify", "refs/heads/feature")).toBe("");
});
test("moved ref blocked and main checkout skipped", () => {
  const p = fixture();
  git(p, "branch", "feature");
  const a = action(p);
  git(p, "checkout", "feature");
  expect(execute(a, true, safe).reason).toBe("Main checkout");
  commit(p, "file", "changed\n");
  expect(execute(a, true, safe).status).toBe("blocked");
});
test("dirty worktree and active thread branch are skipped even if thread moved", () => {
  const p = fixture();
  git(p, "branch", "feature");
  const wt = join(p, "wt");
  git(p, "worktree", "add", wt, "feature");
  const a = action(p);
  writeFileSync(join(wt, "dirty"), "x");
  expect(execute(a, false, safe).status).toBe("skipped");
  rmSync(join(wt, "dirty"));
  expect(
    execute(a, false, { ...safe, activeBranches: ["feature"] }).reason,
  ).toBe("Branch recorded on active thread");
  expect(execute(a, false, { ...safe, cwds: [wt + "/child"] }).status).toBe(
    "skipped",
  );
});
test("archive pushed and verified before unmerged branch deletion", () => {
  const p = fixture();
  const remote = mkdtempSync(join(tmpdir(), "review-bare-"));
  dirs.push(remote);
  expect(run("git", ["init", "--bare", remote]).code).toBe(0);
  git(p, "remote", "add", "origin", remote);
  git(p, "checkout", "-b", "feature");
  commit(p, "file", "unmerged\n");
  git(p, "checkout", "main");
  const a = { ...action(p), archive: true };
  expect(execute(a, true, safe).status).toBe("done");
  expect(
    out(
      p,
      "ls-remote",
      "origin",
      `refs/heads/archive/${new Date().toISOString().slice(0, 10)}/feature`,
    ),
  ).toStartWith(a.sha);
});
