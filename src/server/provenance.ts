import type { ApplicationApi, StoredClone } from "./application";
import type {
  PullRequest,
  LandedVia,
  Landing,
  BranchHistoryItem,
} from "../domain/model";
import { sshCommand } from "./agent-host";

export async function cloneGit(
  app: ApplicationApi,
  clone: StoredClone,
  ...args: string[]
) {
  const host = app.settings().hosts.find((h) => h.id === clone.host);
  if (!host) return "";
  const argv = ["git", "-C", clone.path, ...args];
  const command = host.kind === "ssh" ? sshCommand(host, argv) : argv;
  const p = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const timer = setTimeout(() => p.kill(), 120000);
  const [output, , code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  clearTimeout(timer);
  return code === 0 ? output.trim() : "";
}
export function provenanceIndex(app: ApplicationApi, repo: string) {
  const bySha = new Map<string, PullRequest[]>();
  for (const pr of app.db
    .list<PullRequest>("pull_request")
    .filter((p) => p.repo === repo && p.state === "merged")
    .sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? ""))) {
    for (const sha of new Set([
      pr.headSha,
      ...app.db.commits(pr.id).map((c) => c.sha),
    ])) {
      const rows = bySha.get(sha) ?? [];
      rows.push(pr);
      bySha.set(sha, rows);
    }
  }
  return bySha;
}
export async function linkTip(
  app: ApplicationApi,
  clone: StoredClone,
  sha: string,
  index: Map<string, PullRequest[]>,
): Promise<LandedVia | null> {
  const match = (
    matchedSha: string,
    extraCommitShas: string[],
  ): LandedVia | null => {
    const pr = index.get(matchedSha)?.[0];
    return pr
      ? {
          pullRequestId: pr.id,
          number: pr.number,
          url: pr.url,
          method: pr.mergeMethod ?? "unknown",
          mergeCommitSha: pr.mergeCommitSha ?? null,
          matchedSha,
          extraCommits: extraCommitShas.length,
          extraCommitShas,
        }
      : null;
  };
  const exact = match(sha, []);
  if (exact) return exact;
  // One walk per tip; nearest PR ancestor wins, including across base merges.
  const ancestors = (
    await cloneGit(app, clone, "rev-list", "--topo-order", sha)
  ).split("\n");
  for (const ancestor of ancestors)
    if (index.has(ancestor)) {
      const extra = (
        await cloneGit(app, clone, "rev-list", `${ancestor}..${sha}`)
      )
        .split("\n")
        .filter(Boolean);
      return match(ancestor, extra);
    }
  return null;
}
export async function inferMergeMethod(
  app: ApplicationApi,
  repo: string,
  pr: PullRequest,
  allowForge = true,
): Promise<NonNullable<PullRequest["mergeMethod"]>> {
  if (!pr.mergeCommitSha || pr.state !== "merged") return "unknown";
  for (const clone of app.db
    .list<StoredClone>("clone")
    .filter((c) => c.key === repo)) {
    const parents = await cloneGit(
      app,
      clone,
      "show",
      "-s",
      "--format=%P",
      pr.mergeCommitSha,
    );
    if (
      !parents ||
      !(await cloneGit(app, clone, "show", "-s", "--format=%H", pr.headSha))
    )
      continue;
    const ancestor = await cloneGit(
      app,
      clone,
      "merge-base",
      pr.headSha,
      pr.mergeCommitSha,
    );
    if (parents.split(" ").length > 1)
      return ancestor === pr.headSha ? "merge" : "unknown";
    return ancestor === pr.headSha ? "rebase" : "squash";
  }
  if (!allowForge) return "unknown";
  try {
    const [host, ...parts] = repo.split("/"),
      root = "/repos/" + parts.join("/");
    const raw = (await app
      .forge()
      .request(host, `${root}/git/commits/${pr.mergeCommitSha}`)) as {
      parents?: { sha: string }[];
    };
    const comparison = (await app
      .forge()
      .request(
        host,
        `${root}/compare/${pr.headSha}...${pr.mergeCommitSha}`,
      )) as { merge_base_commit?: { sha: string }; status?: string };
    const ancestor =
      comparison.merge_base_commit?.sha === pr.headSha ||
      ["ahead", "identical"].includes(comparison.status ?? "");
    if (!raw.parents?.length) return "unknown";
    return raw.parents.length > 1
      ? ancestor
        ? "merge"
        : "unknown"
      : ancestor
        ? "rebase"
        : "squash";
  } catch {
    return "unknown";
  }
}
export function parseProvenance(message: string) {
  const first = message.split("\n")[0];
  const n =
    first.match(/Merge pull request #(\d+) from /)?.[1] ??
    first.match(/\(#(\d+)\)(?:\s+from\s+.*)?$/)?.[1];
  const branch =
    first.match(/Merge pull request #\d+ from [^/]+\/(.+)$/)?.[1] ??
    first.match(
      /Merge pull request .+ \(#\d+\) from (.+?)(?: into .+)?$/,
    )?.[1] ??
    first.match(/^Merge branch '([^']+)'/)?.[1];
  const trailers = message.match(/(?:^|\n)Source-Branch:\s*([^\n]+)/)?.[1];
  const url = message.match(/(?:^|\n)Source-PR:\s*([^\n]+)/)?.[1];
  return {
    number: n ? Number(n) : null,
    branch: branch ?? null,
    trailerBranch: trailers ?? null,
    trailerUrl: url ?? null,
    trailerNumber: url?.match(/\/pulls?\/(\d+)(?:[?#].*)?$/)?.[1]
      ? Number(url.match(/\/pulls?\/(\d+)(?:[?#].*)?$/)![1])
      : null,
  };
}
export async function rebuildProvenance(app: ApplicationApi, repo: string) {
  const index = provenanceIndex(app, repo);
  const history = app.db
    .list<BranchHistoryItem>("branch_history")
    .filter((h) => h.repo === repo);
  const prs = app.db
    .list<PullRequest>("pull_request")
    .filter((p) => p.repo === repo && p.state === "merged");
  const byMerge = new Map(
    prs.filter((p) => p.mergeCommitSha).map((p) => [p.mergeCommitSha, p]),
  );
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const byUrl = new Map(prs.map((p) => [p.url, p]));
  for (const clone of app.db
    .list<StoredClone>("clone")
    .filter((c) => c.key === repo)) {
    const tips = new Map<string, LandedVia | null>();
    const link = async (sha: string) => {
      if (!tips.has(sha)) tips.set(sha, await linkTip(app, clone, sha, index));
      return tips.get(sha)!;
    };
    for (const branch of [...clone.branches, ...clone.remoteBranches]) {
      const landedVia = branch.state === "base" ? null : await link(branch.sha);
      app.db.put(
        "provenance",
        JSON.stringify([clone.host, clone.path, branch.name]),
        {
          repo,
          host: clone.host,
          path: clone.path,
          name: branch.name,
          sha: branch.sha,
          landedVia,
        },
      );
    }
    for (const h of history.filter(
      (h) => h.host === clone.host && h.clonePath === clone.path,
    ))
      app.db.put(
        "branch_history",
        JSON.stringify([h.host, h.clonePath, h.branch, h.sha]),
        {
          ...h,
          landedVia: clone.bases.some(
            (b) => b === h.branch || b.replace(/^[^/]+\//, "") === h.branch,
          )
            ? null
            : await link(h.sha),
        },
      );
  }
  const allHistory = app.db
    .list<BranchHistoryItem>("branch_history")
    .filter((h) => h.repo === repo);
  for (const clone of app.db
    .list<StoredClone>("clone")
    .filter((c) => c.key === repo)) {
    for (const base of clone.bases) {
      const log = await cloneGit(
        app,
        clone,
        "log",
        "--since=180 days ago",
        "--format=%H%x00%s%x00%an%x00%cI%x00%B%x00%x1e",
        base,
      );
      for (const record of log.split("\x1e")) {
        const [sha, subject, author, at, message] = record.trim().split("\0");
        if (!sha || !at) continue;
        const parsed = parseProvenance(message ?? subject);
        let pr = byMerge.get(sha),
          via: Landing["via"] = pr ? "merge-commit-sha" : "none";
        let sourceBranch: string | null = pr?.head ?? null;
        if (!pr && (parsed.number || parsed.branch)) {
          pr = parsed.number ? byNumber.get(parsed.number) : undefined;
          sourceBranch = pr?.head ?? parsed.branch;
          via = "message";
        }
        if (via === "none" && (parsed.trailerBranch || parsed.trailerUrl)) {
          pr = parsed.trailerUrl ? byUrl.get(parsed.trailerUrl) : undefined;
          sourceBranch = parsed.trailerBranch ?? pr?.head ?? null;
          via = "trailer";
        }
        // Existing collector patch-id matches supply the last-resort landing link.
        if (via === "none") {
          const b = clone.branches.find((b) => b.squashCommit === sha);
          if (b) {
            sourceBranch = b.name;
            via = "patch-id";
          }
        }
        const branchIds = [
          ...new Set(
            allHistory
              .filter(
                (h) =>
                  !clone.bases.some(
                    (b) =>
                      b === h.branch || b.replace(/^[^/]+\//, "") === h.branch,
                  ),
              )
              .filter((h) =>
                pr
                  ? h.landedVia?.pullRequestId === pr.id
                  : h.branch === sourceBranch,
              )
              .map((h) => repo + "#" + h.branch),
          ),
        ];
        const landing: Landing = {
          sha,
          subject,
          author,
          at,
          base,
          pullRequestId: pr?.id ?? null,
          number: pr?.number ?? parsed.number ?? parsed.trailerNumber,
          sourceBranch,
          method: pr?.mergeMethod ?? (via === "none" ? "direct" : "unknown"),
          via,
          branchIds,
        };
        app.db.put("landing", JSON.stringify([repo, base, sha]), {
          ...landing,
          repo,
        });
      }
    }
  }
  app.reindexBranches();
}
export function pageItems<T>(
  rows: T[],
  input: { page?: number; pageSize?: number },
) {
  const page = Math.max(1, Math.floor(input.page ?? 1)),
    pageSize = Math.min(200, Math.max(1, Math.floor(input.pageSize ?? 50)));
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
  };
}
