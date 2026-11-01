import {
  existsSync,
  realpathSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  statSync,
  mkdtempSync,
} from "node:fs";
import { join, relative, isAbsolute, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { git, run, expand, worktreeRows } from "./git";
import { readThreads } from "./threads";
import { activeStatus } from "../domain/logic";
import type { CloneDeletionSummary } from "../domain/model";
import type { WorkerAction } from "./action-worker";
export type CloneDeletion = {
  cloneId: string;
  name: string;
  roots: readonly string[];
  worktreeDir: string;
  archiveDir: string;
  fingerprint?: string;
  summary?: CloneDeletionSummary;
  archivePath?: string;
};
const inside = (p: string, root: string) =>
  p !== root &&
  !relative(root, p).startsWith("..") &&
  !isAbsolute(relative(root, p));
const canonical = (p: string): string =>
  existsSync(expand(p))
    ? realpathSync(expand(p))
    : join(canonical(dirname(expand(p))), expand(p).split("/").at(-1)!);
const excluded = new Set(
  "node_modules .venv venv target dist build .next .nuxt .turbo .cache __pycache__ .gradle Pods DerivedData .direnv".split(
    " ",
  ),
);
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function executeCloneDeletion(
  item: WorkerAction,
  apply: boolean,
  options: { t3?: boolean; cwds?: string[] } = {},
): WorkerAction {
  const config = item.cloneDeletion!;
  type Mutable<T> = {
    -readonly [P in keyof T]: T[P] extends readonly (infer U)[]
      ? Mutable<U>[]
      : T[P] extends object
        ? Mutable<T[P]>
        : T[P];
  };
  const summary: Mutable<CloneDeletionSummary> = {
    actionId: item.id,
    host: item.target.host,
    path: item.target.repo,
    sizeBytes: null,
    linkedWorktrees: [],
    branches: 0,
    unpushedBranches: [],
    dirtyFiles: 0,
    stashes: 0,
    ignoredKept: { files: 0, bytes: 0 },
    ignoredSkipped: { files: 0, bytes: 0 },
    activeThreads: [],
    blockers: [],
  };
  const result = (reason?: string): WorkerAction => ({
    ...item,
    cloneDeletion: { ...config, summary },
    status: reason ? "blocked" : apply ? "done" : "planned",
    reason:
      reason ??
      (apply ? "Archived and deleted clone" : "Archive before deletion"),
    finishedAt: apply ? new Date().toISOString() : null,
  });
  const checked = (path: string, ...args: string[]) => {
    const r = git(path, ...args);
    if (r.code) throw Error("Git verification failed: " + args[0]);
    return r.out;
  };
  try {
    const repo = canonical(item.target.repo);
    const roots = config.roots.map(canonical);
    if (
      repo === "/" ||
      repo === canonical(homedir()) ||
      roots.includes(repo) ||
      !roots.some((r) => inside(repo, r))
    )
      throw Error("Clone is outside configured roots or is a protected root");
    if (
      canonical(checked(repo, "rev-parse", "--show-toplevel").trim()) !== repo
    )
      throw Error("Clone path is not the git toplevel");
    const common = canonical(
      checked(
        repo,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ).trim(),
    );
    if (!inside(common, repo))
      throw Error("Clone must own its git common directory");
    const rows = worktreeRows(repo);
    const paths = [
      ...new Set([repo, ...rows.map((r) => canonical(r.worktree))]),
    ];
    for (const p of paths)
      if (
        p !== repo &&
        !roots.concat([canonical(config.worktreeDir)]).some((r) => inside(p, r))
      )
        throw Error("Linked worktree is outside allowed roots");
    const archiveRoot = canonical(config.archiveDir);
    if (paths.some((p) => p === archiveRoot || inside(archiveRoot, p)))
      throw Error("Archive directory is inside a checkout");
    const refs = checked(repo, "for-each-ref");
    const stash = checked(repo, "stash", "list");
    const statuses = paths.map((p) =>
      existsSync(p)
        ? checked(p, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        : "missing",
    );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          refs,
          stash,
          checked(repo, "worktree", "list", "--porcelain"),
          statuses,
        ]),
      )
      .digest("hex");
    if (apply && fingerprint !== config.fingerprint)
      throw Error("Clone fingerprint changed; plan again");
    config.fingerprint = fingerprint;
    const threads =
      options.t3 === false ? { threads: [], errors: [] } : readThreads();
    if (threads.errors.length) throw Error("Cannot verify T3 activity");
    const matches = (p: string) =>
      paths.some((root) => p === root || inside(p, root));
    summary.activeThreads = threads.threads
      .filter(
        (t) =>
          activeStatus(t.status) &&
          [t.worktree, t.projectRoot].some((p) => p && matches(canonical(p))),
      )
      .map((t) => ({ id: t.id, title: t.title }));
    if (summary.activeThreads.length)
      throw Error("Active T3 thread on checkout");
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
        throw Error("Cannot verify process working directories");
      cwds = r.out
        .split("\n")
        .filter((l) => l.startsWith("n/"))
        .map((l) => l.slice(1));
    }
    if (cwds.some((p) => matches(canonical(p))))
      throw Error("Process working directory inside checkout");
    const files: {
      path: string;
      files: string[];
      skipped: string[];
      staged: string;
      unstaged: string;
    }[] = [];
    for (const [i, p] of paths.entries()) {
      const missing = !existsSync(p);
      if (p !== repo)
        summary.linkedWorktrees.push({
          path: p,
          branch:
            rows
              .find((r) => canonical(r.worktree) === p)
              ?.branch?.replace(/^refs\/heads\//, "") ?? null,
          dirty: !missing && Boolean(statuses[i]),
          missing,
        });
      if (missing) continue;
      const names = (...args: string[]) =>
        checked(p, ...args)
          .split("\0")
          .filter(Boolean);
      const changed = [
        ...new Set([
          ...names("diff", "--name-only", "-z"),
          ...names("diff", "--cached", "--name-only", "-z"),
          ...names("ls-files", "--others", "--exclude-standard", "-z"),
        ]),
      ];
      summary.dirtyFiles += changed.length;
      const kept: string[] = [],
        skipped: string[] = [];
      for (const name of names(
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      )) {
        const size = lstatSync(join(p, name)).size;
        const skip =
          name.split("/").some((n) => excluded.has(n)) ||
          size > 5 * 1024 * 1024;
        const counts = skip ? summary.ignoredSkipped : summary.ignoredKept;
        counts.files++;
        counts.bytes += size;
        (skip ? skipped : kept).push(name);
      }
      files.push({
        path: p,
        files: [...new Set([...changed, ...kept])].filter((n) =>
          existsSync(join(p, n)),
        ),
        skipped,
        staged: checked(p, "diff", "--cached", "--binary"),
        unstaged: checked(p, "diff", "--binary"),
      });
    }
    summary.branches = checked(
      repo,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    )
      .trim()
      .split("\n")
      .filter(Boolean).length;
    summary.stashes = stash.trim().split("\n").filter(Boolean).length;
    const base = [
      "refs/remotes/origin/HEAD",
      "refs/heads/main",
      "refs/heads/master",
    ].find((ref) => git(repo, "rev-parse", "--verify", ref).code === 0);
    for (const line of checked(
      repo,
      "for-each-ref",
      "--format=%(refname:short)\t%(upstream)",
      "refs/heads",
    )
      .trim()
      .split("\n")
      .filter(Boolean)) {
      const [name, upstream] = line.split("\t");
      const integrated = Boolean(
        base && git(repo, "merge-base", "--is-ancestor", name, base).code === 0,
      );
      const ahead =
        upstream && git(repo, "rev-parse", "--verify", upstream).code === 0
          ? Number(
              checked(
                repo,
                "rev-list",
                "--count",
                upstream + ".." + name,
              ).trim(),
            )
          : Number(
              checked(
                repo,
                "rev-list",
                "--count",
                name,
                "--not",
                "--remotes",
              ).trim(),
            );
      if (ahead && (upstream || !integrated))
        summary.unpushedBranches.push({ name, ahead, integrated });
    }
    const du = run("du", [
      "-sk",
      ...paths.filter((p) => existsSync(p) && (p === repo || !inside(p, repo))),
    ]);
    if (!du.code)
      summary.sizeBytes = du.out
        .trim()
        .split("\n")
        .reduce((n, l) => n + Number(l.split(/\s/)[0]) * 1024, 0);
    if (!apply) return result();
    // Unique action suffix avoids collisions for several clones on one host.
    const archive = join(
      archiveRoot,
      config.name.replace(/[^a-zA-Z0-9._-]/g, "_"),
      new Date().toISOString().replaceAll(":", "-") +
        "-" +
        item.target.host.replace(/[^a-zA-Z0-9._-]/g, "_") +
        "-" +
        item.id,
    );
    mkdirSync(archive, { recursive: true, mode: 0o700 });
    const verify = (p: string) => {
      if (!existsSync(p) || !statSync(p).size)
        throw Error("Archive verification failed");
    };
    if (refs.trim()) {
      const bundle = join(archive, "repo.bundle");
      checked(repo, "bundle", "create", bundle, "--all");
      checked(repo, "bundle", "verify", bundle);
      verify(bundle);
    }
    // `--all` only carries refs/stash (stash@{0}); older entries live in its reflog.
    // Bundle every entry from a throwaway repository borrowing the clone's objects,
    // so the clone itself stays untouched for the fingerprint recheck.
    const stashes = summary.stashes
      ? checked(repo, "log", "-g", "--format=%H", "refs/stash")
          .trim()
          .split("\n")
          .filter(Boolean)
      : [];
    if (stashes.length) {
      const tmp = mkdtempSync(join(tmpdir(), "repo-review-stash-"));
      try {
        checked(tmp, "init", "-q", "--bare");
        writeFileSync(
          join(tmp, "objects", "info", "alternates"),
          join(common, "objects") + "\n",
        );
        for (const [n, sha] of stashes.entries())
          checked(tmp, "update-ref", "refs/stashes/" + n, sha);
        const bundle = join(archive, "stashes.bundle");
        checked(tmp, "bundle", "create", bundle, "--all");
        checked(tmp, "bundle", "verify", bundle);
        verify(bundle);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    mkdirSync(join(archive, "worktrees"), { mode: 0o700 });
    for (const [i, f] of files.entries()) {
      if (!f.files.length && !f.staged && !f.unstaged) continue;
      const tar = join(archive, "worktrees", i + ".tar.gz");
      // NUL lists preserve whitespace, newlines, and leading dashes in paths.
      const r = run(
        "tar",
        ["-czf", tar, "-C", f.path, "--null", "-T", "-"],
        f.files.join("\0") + (f.files.length ? "\0" : ""),
      );
      if (r.code) throw Error("Archive tar failed");
      verify(tar);
      if (f.staged) {
        writeFileSync(
          join(archive, "worktrees", i + ".staged.patch"),
          f.staged,
          { mode: 0o600 },
        );
        verify(join(archive, "worktrees", i + ".staged.patch"));
      }
      if (f.unstaged) {
        writeFileSync(
          join(archive, "worktrees", i + ".unstaged.patch"),
          f.unstaged,
          { mode: 0o600 },
        );
        verify(join(archive, "worktrees", i + ".unstaged.patch"));
      }
    }
    writeFileSync(
      join(archive, "info.json"),
      JSON.stringify(
        {
          repositoryId: item.repoKey,
          name: config.name,
          host: item.target.host,
          path: repo,
          remotes: checked(repo, "remote", "-v").replace(
            /(https?:\/\/)[^/@\s]+@/g,
            "$1",
          ),
          branches: checked(
            repo,
            "for-each-ref",
            "--format=%(refname:short) %(objectname)",
            "refs/heads",
          ),
          linkedWorktrees: summary.linkedWorktrees,
          createdAt: item.createdAt,
          archivedAt: new Date().toISOString(),
          noRefs: !refs.trim(),
          stashes: stashes.length,
          worktrees: files.map((f, i) => ({ index: i, path: f.path })),
          skippedIgnored: files
            .flatMap((f) => f.skipped.map((n) => join(f.path, n)))
            .slice(0, 2000),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    verify(join(archive, "info.json"));
    // Recheck after the archive, before the first removal.
    const now = createHash("sha256")
      .update(
        JSON.stringify([
          checked(repo, "for-each-ref"),
          checked(repo, "stash", "list"),
          checked(repo, "worktree", "list", "--porcelain"),
          paths.map((p) =>
            existsSync(p)
              ? checked(
                  p,
                  "status",
                  "--porcelain=v1",
                  "-z",
                  "--untracked-files=all",
                )
              : "missing",
          ),
        ]),
      )
      .digest("hex");
    if (now !== fingerprint)
      throw Error("Clone fingerprint changed during archive");
    for (const p of paths.filter((p) => p !== repo && !inside(p, repo)))
      rmSync(p, { recursive: true, force: true });
    rmSync(repo, { recursive: true });
    config.archivePath = archive;
    item = {
      ...item,
      restore:
        "git clone " +
        quote(join(archive, "repo.bundle")) +
        " " +
        quote(repo) +
        "; restore stashes with git fetch stashes.bundle 'refs/stashes/*:refs/stashes/*' and, from the highest number down to 0, git stash store -m restored refs/stashes/<n>; recreate linked worktrees using info.json, then untar worktrees/<n>.tar.gz in each checkout and apply <n>.staged.patch with git apply --index and <n>.unstaged.patch with git apply (for a ref-less repository: git init instead of clone).",
    };
    return result();
  } catch (e) {
    const reason = e instanceof Error ? e.message : "Clone deletion refused";
    summary.blockers.push(reason);
    return result(reason);
  }
}
