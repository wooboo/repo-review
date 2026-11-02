import { existsSync, lstatSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { Branch, Clone, Thread, Worktree } from "../domain/model";
import { normalizeUrl, safeUrl } from "../domain/logic";
import { git, out, run, operations, worktreeRows } from "./git";
export function worktree(
  path: string,
  row: Record<string, string>,
  main: boolean,
): Worktree {
  const exists = existsSync(path);
  const status = exists
    ? git(
        path,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      )
    : { code: 1, out: "", error: "Missing worktree" };
  const entries = status.out.split("\0");
  const files: Worktree["files"][number][] = [];
  let staged = 0,
    unstaged = 0,
    untracked = 0,
    conflicts = 0,
    total = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2),
      name = e.slice(3);
    if ("RC".includes(xy[0])) i++;
    if (xy === "??") untracked++;
    else if (xy.includes("U") || ["AA", "DD"].includes(xy)) conflicts++;
    else {
      if (xy[0] !== " ") staged++;
      if (xy[1] !== " ") unstaged++;
    }
    total++;
    let mtime = null;
    try {
      mtime = lstatSync(join(path, name)).mtime.toISOString();
    } catch {}
    if (files.length < 300) files.push({ path: name, xy, mtime });
  }
  return {
    newestChangeAt:
      files
        .map((f) => f.mtime)
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null,
    lastGitActivityAt: exists
      ? out(path, "log", "-1", "--format=%cI") || null
      : null,
    path,
    head: row.HEAD ?? "",
    branch: row.branch?.replace("refs/heads/", "") ?? null,
    main,
    exists,
    locked: "locked" in row,
    prunable: "prunable" in row,
    detached: "detached" in row,
    operations: exists
      ? operations(
          out(path, "rev-parse", "--path-format=absolute", "--git-dir"),
        )
      : [],
    submodules: exists
      ? out(path, "submodule", "status").split("\n").filter(Boolean)
      : [],
    missing: !exists,
    dirty: exists && (total > 0 || status.code !== 0),
    files,
    total,
    staged,
    unstaged,
    untracked,
    conflicts,
    error: status.code ? status.error : null,
  };
}
const trunks = ["main", "master", "integration", "develop", "trunk"];
export function analyzeBranch(
  path: string,
  name: string,
  ref: string,
  bases: readonly string[],
  primary: string,
  localBases: readonly string[],
): Branch {
  const fields = out(
    path,
    "log",
    "-1",
    "--format=%H%x00%cI%x00%an%x00%s",
    ref,
  ).split("\0");
  const [sha = "", date = "", author = "", subject = ""] = fields;
  const upstream = out(path, "for-each-ref", "--format=%(upstream:short)", ref);
  const track = out(
    path,
    "for-each-ref",
    "--format=%(upstream:track,nobracket)",
    ref,
  );
  const vsBases: Record<string, { ahead: number; behind: number }> = {};
  for (const b of bases) {
    const r = git(path, "rev-list", "--left-right", "--count", `${b}...${sha}`);
    if (!r.code) {
      const [behind, ahead] = r.out.trim().split(/\s+/).map(Number);
      vsBases[b] = { ahead, behind };
    }
  }
  const base =
    Object.keys(vsBases).sort(
      (a, b) =>
        vsBases[a].ahead - vsBases[b].ahead ||
        Number(b === primary) - Number(a === primary) ||
        vsBases[a].behind - vsBases[b].behind,
    )[0] ?? null;
  const mergeBase = base ? out(path, "merge-base", base, sha) || null : null;
  const onRemotes: Record<string, string> = {};
  for (const l of out(
    path,
    "for-each-ref",
    "--format=%(refname:short)%00%(objectname)",
    "refs/remotes",
  ).split("\n")) {
    const [n, s] = l.split("\0");
    if (n?.endsWith("/" + name)) onRemotes[n.slice(0, -name.length - 1)] = s;
  }
  const own = base
    ? out(path, "log", "--format=%aI", `${base}..${sha}`)
        .split("\n")
        .filter(Boolean)
    : [];
  const cherry = base ? git(path, "cherry", base, sha) : { code: 1, out: "" };
  const cherryLines = cherry.code === 0 ? cherry.out.split("\n") : [];
  const upstreamCounts = upstream
    ? out(path, "rev-list", "--left-right", "--count", `${sha}...${upstream}`)
        .split(/\s+/)
        .map(Number)
    : [];
  const a: { -readonly [K in keyof Branch]: Branch[K] } = {
    authorDate: out(path, "log", "-1", "--format=%aI", ref),
    mergeBaseDate: mergeBase
      ? out(path, "log", "-1", "--format=%cI", mergeBase)
      : null,
    baseMovedAt:
      mergeBase && base
        ? out(
            path,
            "log",
            "--reverse",
            "--format=%cI",
            `${mergeBase}..${base}`,
          ).split("\n")[0] || null
        : null,
    firstOwnCommitAt: own.at(-1) ?? null,
    lastOwnCommitAt: own[0] ?? null,
    cherryApplied: cherryLines.filter((l) => l.startsWith("-")).length,
    cherryUnapplied: cherryLines.filter((l) => l.startsWith("+")).length,
    upstreamAhead: upstreamCounts[0] || 0,
    upstreamBehind: upstreamCounts[1] || 0,
    name,
    sha,
    date,
    author,
    subject,
    upstream,
    upstreamGone: track === "gone",
    onRemotes,
    unpushed: Number(
      out(path, "rev-list", "--count", sha, "--not", "--remotes") || 0,
    ),
    unique: Number(
      out(
        path,
        "rev-list",
        "--count",
        sha,
        "--not",
        `--exclude=refs/heads/${name}`,
        "--branches",
        "--remotes",
        "--tags",
      ) || 0,
    ),
    base,
    baseSha: base ? out(path, "rev-parse", base) : null,
    mergeBase,
    vsBases,
    ahead: base ? vsBases[base].ahead : 0,
    behind: base ? vsBases[base].behind : 0,
    state: "unmerged",
    squashCommit: null,
    containedIn: [],
    commits: [],
    diffstat: "",
    residual: "",
  };
  if (localBases.includes(name) || bases.includes(name)) {
    a.state = "base";
    return a;
  }
  if (!base) {
    a.state = "no-base";
    return a;
  }
  if (a.ahead === 0) {
    a.state = "merged";
    return a;
  }
  a.commits = out(
    path,
    "log",
    "-25",
    "--format=%H%x00%aI%x00%s%x00%an",
    `${base}..${sha}`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, at, subject, author] = line.split("\0");
      return { sha, at, subject, author };
    });
  a.diffstat = mergeBase
    ? out(path, "diff", "--shortstat", mergeBase, sha)
    : "";
  if (
    !cherry.code &&
    cherry.out.includes("-") &&
    !cherry.out.split("\n").some((l) => l.startsWith("+"))
  ) {
    a.state = "patch-merged";
    return a;
  }
  const files = mergeBase
    ? git(path, "diff", "--name-only", "-z", mergeBase, sha)
        .out.split("\0")
        .filter(Boolean)
    : [];
  if (mergeBase && files.length && files.length <= 2000) {
    const diff = git(path, "diff", "--no-color", mergeBase, sha);
    const pid = run(
      "git",
      ["patch-id", "--stable"],
      `commit ${sha}\n${diff.out}`,
    ).out.split(/\s+/)[0];
    const log = git(
      path,
      "log",
      "-p",
      "--full-diff",
      "--no-merges",
      "--no-color",
      "--format=commit %H",
      "-n",
      "3000",
      `${mergeBase}..${base}`,
      "--",
      ...files,
    );
    if (pid && log.code === 0) {
      const hit = run("git", ["patch-id", "--stable"], log.out)
        .out.split("\n")
        .map((l) => l.split(" "))
        .find((l) => l[0] === pid);
      if (hit) {
        a.state = "squash-merged";
        a.squashCommit = hit[1];
        return a;
      }
    }
    if (git(path, "diff", "--quiet", base, sha, "--", ...files).code === 0) {
      a.state = "content-in-base";
      return a;
    }
    a.residual = out(path, "diff", "--shortstat", base, sha, "--", ...files);
  }
  a.containedIn = out(
    path,
    "for-each-ref",
    "--contains",
    sha,
    "--format=%(refname:short)%00%(symref)",
    "refs/heads",
    "refs/remotes",
  )
    .split("\n")
    .filter((l) => l && !l.split("\0")[1])
    .map((l) => l.split("\0")[0])
    .filter((n) => n !== name)
    .slice(0, 15);
  return a;
}
export function collectRepo(
  commonDir: string,
  sample: string,
  fetch: boolean,
  threads: readonly Thread[] = [],
): Clone {
  const rows = worktreeRows(sample);
  const path = rows[0]?.worktree ?? sample;
  const remotes = out(sample, "remote")
    .split("\n")
    .filter(Boolean)
    .map((name) => {
      const url = safeUrl(out(sample, "remote", "get-url", name));
      const pushurl = safeUrl(out(sample, "remote", "get-url", "--push", name));
      const f = fetch
        ? git(sample, "fetch", "--prune", "--no-tags", name)
        : null;
      let defaultBranch = out(
        sample,
        "symbolic-ref",
        "--quiet",
        `refs/remotes/${name}/HEAD`,
      ).replace(`refs/remotes/${name}/`, "");
      if (!defaultBranch && fetch)
        defaultBranch =
          out(sample, "ls-remote", "--symref", name, "HEAD").match(
            /ref: refs\/heads\/(.+)\tHEAD/,
          )?.[1] ?? "";
      return {
        name,
        url,
        pushurl,
        key: normalizeUrl(url),
        defaultBranch,
        lastFetchAt: (() => {
          try {
            return lstatSync(join(commonDir, "FETCH_HEAD")).mtime.toISOString();
          } catch {
            return null;
          }
        })(),
        fetchError: f?.code ? f.error.slice(-400) : null,
      };
    });
  const refs = out(
    sample,
    "for-each-ref",
    "--format=%(refname:short)%00%(symref)",
    "refs/heads",
    "refs/remotes",
  )
    .split("\n")
    .filter((l) => l && !l.split("\0")[1])
    .map((l) => l.split("\0")[0]);
  const bases = [
    ...new Set([
      ...remotes
        .map((r) => (r.defaultBranch ? `${r.name}/${r.defaultBranch}` : ""))
        .filter((b) => refs.includes(b)),
      ...["origin", "upstream"].flatMap((r) =>
        trunks.map((b) => `${r}/${b}`).filter((b) => refs.includes(b)),
      ),
    ]),
  ];
  if (!bases.length)
    bases.push(...trunks.filter((b) => refs.includes(b)).slice(0, 1));
  const primary = bases[0] ?? "";
  const roots = out(sample, "rev-list", "--max-parents=0", primary || "--all")
    .split("\n")
    .filter(Boolean);
  const local = out(
    sample,
    "for-each-ref",
    "--format=%(refname:strip=2)",
    "refs/heads",
  )
    .split("\n")
    .filter(Boolean);
  const localBases = bases.map((b) =>
    b.includes("/") ? b.slice(b.indexOf("/") + 1) : b,
  );
  const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const top = out(sample, "ls-tree", "--name-only", primary || "HEAD").split(
    "\n",
  );
  const readme = top.find((n) => n.toLowerCase().startsWith("readme"));
  const extensions: Record<string, number> = {};
  for (const file of out(
    sample,
    "ls-tree",
    "-r",
    "--name-only",
    primary || "HEAD",
  ).split("\n")) {
    const e = extname(file);
    if (e) extensions[e] = (extensions[e] ?? 0) + 1;
  }
  const about = JSON.stringify({
    extensions,
    claude: out(sample, "show", `${primary || "HEAD"}:CLAUDE.md`).slice(
      0,
      2500,
    ),
    top,
    readme: readme
      ? out(sample, "show", `${primary || "HEAD"}:${readme}`).slice(0, 6000)
      : "",
    agents: out(sample, "show", `${primary || "HEAD"}:AGENTS.md`).slice(
      0,
      2500,
    ),
    manifest: out(sample, "show", `${primary || "HEAD"}:package.json`).slice(
      0,
      1500,
    ),
    commits: out(sample, "log", "-25", "--format=%as %s"),
    commitCount: out(sample, "rev-list", "--count", primary || "HEAD"),
  });
  return {
    path,
    firstCommitAt:
      out(sample, "log", "--reverse", "--format=%aI", primary || "HEAD").split(
        "\n",
      )[0] ?? "",
    lastCommitAt: out(sample, "log", "-1", "--format=%cI", primary || "HEAD"),
    commonDir,
    name: basename(path),
    key: origin?.key || `local/${basename(path)}@${roots[0] ?? "empty"}`,
    roots,
    remotes,
    bases,
    branches: local.map((n) =>
      analyzeBranch(sample, n, "refs/heads/" + n, bases, primary, localBases),
    ),
    remoteBranches: refs
      .filter((n) => n.startsWith((origin?.name ?? "origin") + "/"))
      .slice(0, 300)
      .map((n) =>
        analyzeBranch(
          sample,
          n,
          "refs/remotes/" + n,
          bases,
          primary,
          localBases,
        ),
      ),
    worktrees: rows
      .filter((r) => !("bare" in r))
      .map((r, i) => worktree(r.worktree, r, i === 0)),
    stashes: out(sample, "stash", "list", "--format=%gd %H %cI %gs")
      .split("\n")
      .filter(Boolean),
    threads: threads.filter((t) =>
      rows.some(
        (r) => r.worktree === t.worktree || r.worktree === t.projectRoot,
      ),
    ),
    about,
    errors: [],
  };
}
