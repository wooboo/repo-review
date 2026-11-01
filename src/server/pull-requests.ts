import { emitChange } from "./events";
import { inferMergeMethod, rebuildProvenance } from "./provenance";
import { Schema, Data } from "effect";
import {
  PullRequest,
  type PullRequestDetail,
  type ChecksSummary,
} from "../domain/model";
import type { ApplicationApi } from "./application";
export class ForgeUnavailable extends Data.TaggedError("ForgeUnavailable")<{
  message: string;
}> {}
export class ForgeRejected extends Data.TaggedError("ForgeRejected")<{
  message: string;
}> {}
export class NotFound extends Data.TaggedError("NotFound")<{
  message: string;
}> {}
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" ? (v as Row) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const author = (v: unknown) => str(obj(v).login ?? obj(v).username);
export function checkState(v: unknown): ChecksSummary["state"] {
  const s = str(v).toLowerCase();
  return ["success", "neutral", "skipped"].includes(s)
    ? "success"
    : [
          "failure",
          "error",
          "cancelled",
          "timed_out",
          "action_required",
        ].includes(s)
      ? "failure"
      : s
        ? "pending"
        : "none";
}
export function normalizePullRequest(
  repo: string,
  forge: "github" | "forgejo",
  value: unknown,
  known = false,
): PullRequest {
  const p = obj(value),
    head = obj(p.head),
    base = obj(p.base),
    number = Number(p.number);
  return Schema.decodeUnknownSync(PullRequest)({
    id: `${repo}!${number}`,
    repo,
    forge,
    number,
    title: str(p.title),
    url: str(p.html_url),
    author: author(p.user),
    state:
      p.merged_at || p.merged
        ? "merged"
        : p.state === "open"
          ? "open"
          : "closed",
    draft: Boolean(p.draft),
    head: str(head.ref),
    headSha: str(head.sha),
    base: str(base.ref),
    branchId: known ? `${repo}#${str(head.ref)}` : null,
    createdAt: str(p.created_at),
    updatedAt: str(p.updated_at),
    mergedAt: p.merged_at ?? null,
    mergeCommitSha: p.merge_commit_sha ?? null,
    mergeMethod: null,
    commitCount: 0,
    checks: { state: "none", total: 0, failed: 0, pending: 0 },
    review: "none",
    mergeable: typeof p.mergeable === "boolean" ? p.mergeable : null,
  });
}
export function normalizeDetail(
  pr: PullRequest,
  raw: unknown,
  diff: string,
  files: unknown[],
  reviews: unknown[],
  comments: unknown[],
  checks: unknown[],
): PullRequestDetail {
  const latest = new Map<string, Row>();
  for (const c of checks.map(obj)) {
    const name = str(c.name ?? c.context);
    if (!latest.has(name)) latest.set(name, c);
  }
  const checkRuns = [...latest.values()].map((c) => ({
    name: str(c.name ?? c.context),
    state: checkState(c.conclusion ?? c.status ?? c.state),
    url: str(c.html_url ?? c.target_url ?? c.url) || null,
  }));
  const failed = checkRuns.filter((c) => c.state === "failure").length,
    pending = checkRuns.filter((c) => c.state === "pending").length;
  const latestReviews = new Map<string, string>();
  for (const r of reviews.map(obj)) {
    const state = str(r.state).toLowerCase();
    if (!["commented", "pending"].includes(state))
      latestReviews.set(author(r.user), state);
  }
  const states = [...latestReviews.values()];
  const bytes = Buffer.from(diff);
  return {
    ...pr,
    commits: [],
    checks: {
      state: failed
        ? "failure"
        : pending
          ? "pending"
          : checkRuns.length
            ? "success"
            : "none",
      total: checkRuns.length,
      failed,
      pending,
    },
    review:
      states.includes("changes_requested") || states.includes("request_changes")
        ? "changes_requested"
        : states.includes("approved")
          ? "approved"
          : states.length ||
              (Array.isArray(obj(raw).requested_reviewers) &&
                (obj(raw).requested_reviewers as unknown[]).length)
            ? "review_required"
            : "none",
    body: str(obj(raw).body),
    diff: bytes
      .subarray(0, 500_000)
      .toString("utf8")
      .replace(/\uFFFD$/, ""),
    diffTruncated: bytes.length > 500_000,
    files: files.map(obj).map((f) => ({
      path: str(f.filename ?? f.new_filename),
      status: str(f.status),
      additions: Number(f.additions ?? 0),
      deletions: Number(f.deletions ?? 0),
    })),
    checkRuns,
    reviews: reviews.map(obj).map((r) => ({
      author: author(r.user),
      state: str(r.state),
      body: str(r.body),
      at: str(r.submitted_at ?? r.created_at),
    })),
    comments: comments.map(obj).map((c) => ({
      author: author(c.user),
      body: str(c.body),
      at: str(c.created_at),
    })),
  };
}
export function parsePrId(id: string) {
  const match = /^(.*)!([1-9]\d*)$/.exec(id);
  if (!match) throw new NotFound({ message: "Invalid pull request id" });
  return { repo: match[1], number: Number(match[2]) };
}
export async function getPullRequest(
  app: ApplicationApi,
  id: string,
  summaryOnly = false,
  rawPull?: unknown,
  includeCommits = true,
): Promise<PullRequestDetail | null> {
  const { repo, number } = parsePrId(id),
    host = repo.split("/")[0],
    forge = app.settings().forges.find((f) => f.host === host);
  if (!forge) throw new ForgeUnavailable({ message: "Forge not configured" });
  const service = app.forge(),
    root = `/repos/${repo.slice(host.length + 1)}`,
    path = `${root}/pulls/${number}`;
  try {
    const raw = obj(rawPull ?? (await service.request(host, path)));
    const pr = normalizePullRequest(
      repo,
      forge.kind,
      raw,
      !!app.getBranch(`${repo}#${str(obj(raw.head).ref)}`),
    );
    const pages = async (p: string, required = false) => {
      const rows: unknown[] = [];
      for (let page = 1; ; page++) {
        const r = await service
          .request(
            host,
            `${p}${p.includes("?") ? "&" : "?"}per_page=100&limit=100&page=${page}`,
          )
          .catch((e) => {
            if (!required && e instanceof NotFound) return [];
            throw e;
          });
        const a = Array.isArray(r) ? r : [];
        rows.push(...a);
        if (a.length < 100) break;
      }
      return rows;
    };
    const [diff, files, reviews, comments, statuses] = await Promise.all([
      summaryOnly
        ? Promise.resolve("")
        : service.request(
            host,
            forge.kind === "forgejo" ? path + ".diff" : path,
            "GET",
            undefined,
            true,
          ),
      summaryOnly ? Promise.resolve([]) : pages(path + "/files"),
      pages(path + "/reviews"),
      summaryOnly
        ? Promise.resolve([])
        : pages(root + `/issues/${number}/comments`),
      pages(root + `/commits/${pr.headSha}/statuses`),
    ]);
    if (!summaryOnly && forge.kind === "github")
      comments.push(...(await pages(path + "/comments")));
    let checks: unknown[] = statuses;
    if (forge.kind === "github") {
      for (let page = 1; ; page++) {
        const c = obj(
          await service.request(
            host,
            root +
              `/commits/${pr.headSha}/check-runs?per_page=100&page=${page}`,
          ),
        );
        const rows = Array.isArray(c.check_runs) ? c.check_runs : [];
        checks = [...checks, ...rows];
        if (rows.length < 100) break;
      }
    }
    if (forge.kind === "forgejo") {
      try {
        const response = obj(
          await service.request(host, root + "/actions/runs?limit=100"),
        );
        const runs = Array.isArray(response.workflow_runs)
          ? response.workflow_runs
          : Array.isArray(response.runs)
            ? response.runs
            : [];
        checks = [
          ...checks,
          ...runs
            .map(obj)
            .filter((r) => r.head_sha === pr.headSha)
            .map((r) => ({
              ...r,
              name: r.name ?? r.workflow_id,
              status: r.status,
              conclusion: r.conclusion,
              html_url: r.html_url,
            })),
        ];
      } catch (e) {
        if (!(e instanceof NotFound)) throw e;
      }
    }
    const sourceRepo = str(obj(obj(raw.head).repo).full_name).toLowerCase();
    const repoName = repo.slice(host.length + 1).toLowerCase();
    includeCommits =
      includeCommits && (sourceRepo === repoName || !!pr.branchId);
    const cacheKey = `pr-commits:${id}:${pr.headSha}`;
    const commits =
      app.db.get<import("../domain/model").PullRequestCommit[]>(
        "settings",
        cacheKey,
      ) ??
      (!includeCommits || pr.state === "closed"
        ? []
        : (await pages(path + "/commits", true)).map(obj).map((c) => {
            const commit = obj(c.commit),
              a = obj(commit.author);
            return {
              sha: str(c.sha),
              subject: str(commit.message).split("\n")[0],
              author: str(a.name),
              at: str(a.date),
            };
          }));
    const normalized = normalizeDetail(
      pr,
      raw,
      str(diff),
      files,
      reviews,
      comments,
      checks,
    );
    const detail = {
      ...normalized,
      commits,
      commitCount: commits.length,
      mergeMethod:
        normalized.state === "merged"
          ? await inferMergeMethod(app, repo, normalized)
          : null,
    };
    app.db.put(
      "pull_request",
      id,
      summaryOnly ? Schema.decodeUnknownSync(PullRequest)(detail) : detail,
    );
    app.db.putCommits(id, commits);
    if (includeCommits && pr.state !== "closed")
      app.db.put("settings", cacheKey, commits);
    return detail;
  } catch (e) {
    if (e instanceof NotFound && !rawPull) return null;
    throw e;
  }
}
// All sync entry points share one queue, including scans on different hosts.
const syncQueues = new WeakMap<ApplicationApi, Promise<unknown>>();
export function refreshPullRequests(
  app: ApplicationApi,
  repo?: string,
  full = false,
): Promise<PullRequest[]> {
  const next = (syncQueues.get(app) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const service = app.forge();
      service.syncRequests = 0;
      service.syncActive = true;
      try {
        return await sync(app, repo, full);
      } finally {
        service.syncActive = false;
        for (const key of new Set(
          app.db
            .list<{ key: string }>("clone")
            .map((c) => c.key)
            .filter((key) => !repo || repo === key),
        )) {
          emitChange({ type: "pull-requests", id: key });
          emitChange({ type: "inventory", id: key });
        }
      }
    });
  syncQueues.set(app, next);
  return next;
}
async function sync(app: ApplicationApi, repo?: string, full = false) {
  const clones = app.db.list<import("./application").StoredClone>("clone");
  const keys = [...new Set(clones.map((c) => c.key))].filter(
    (key) =>
      (!repo || key === repo) &&
      app.settings().forges.some((f) => key.startsWith(f.host + "/")),
  );
  const localBranches = new Set(
    clones.flatMap((c) => c.branches.map((b) => `${c.key}#${b.name}`)),
  );
  const result: PullRequest[] = [];
  for (const key of keys) {
    const [host, owner, name] = key.split("/"),
      service = app.forge();
    const forge = app.settings().forges.find((f) => f.host === host)!;
    await service.prepare(host);
    const watermark = full
      ? undefined
      : app.db.get<string>("settings", "pr-sync:" + key);
    const rows = await service.listPullRequests(key, watermark);
    for (let offset = 0; offset < rows.length; offset += 10) {
      const batch = rows.slice(offset, offset + 10).map((raw) => {
        const p = obj(raw),
          pr = normalizePullRequest(
            key,
            forge.kind,
            p,
            localBranches.has(`${key}#${str(obj(p.head).ref)}`),
          );
        const eligible =
          (pr.state === "open" || pr.state === "merged") &&
          (str(obj(obj(p.head).repo).full_name).toLowerCase() ===
            `${owner}/${name}`.toLowerCase() ||
            clones.some(
              (c) =>
                c.key === key && c.branches.some((b) => b.name === pr.head),
            ));
        const cacheKey = `pr-commits:${pr.id}:${pr.headSha}`;
        let cached = app.db.get<import("../domain/model").PullRequestCommit[]>(
          "settings",
          cacheKey,
        );
        if (!cached) {
          const previous = app.db.get<PullRequest>("pull_request", pr.id);
          if (previous?.headSha === pr.headSha) {
            const stored = app.db.commits(pr.id);
            if (stored.length) {
              cached = stored;
              app.db.put("settings", cacheKey, stored);
            }
          }
        }
        return {
          p,
          pr,
          eligible,
          cacheKey,
          commits: cached,
          cursor: null as string | null,
        };
      });
      if (forge.kind === "github") {
        let pending = batch.filter((b) => b.eligible && !b.commits);
        const collected = new Map<
          number,
          import("../domain/model").PullRequestCommit[]
        >();
        while (pending.length) {
          const fields = pending
            .map(
              (b) =>
                `p${b.pr.number}: pullRequest(number:${b.pr.number}) { commits(first:100, after:${JSON.stringify(b.cursor)}) { nodes { commit { oid messageHeadline author { name date } } } pageInfo { hasNextPage endCursor } } }`,
            )
            .join("\n");
          const data = await service.graphql(
            host,
            `query { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { ${fields} } }`,
          );
          const repository = obj(data.repository);
          pending = pending.filter((b) => {
            const connection = obj(obj(repository[`p${b.pr.number}`]).commits),
              info = obj(connection.pageInfo);
            if (!Array.isArray(connection.nodes))
              throw new ForgeRejected({
                message: "Incomplete GraphQL commit page",
              });
            const commits = collected.get(b.pr.number) ?? [];
            commits.push(
              ...connection.nodes.map(obj).map((n) => {
                const c = obj(n.commit),
                  a = obj(c.author);
                return {
                  sha: str(c.oid),
                  subject: str(c.messageHeadline),
                  author: str(a.name),
                  at: str(a.date),
                };
              }),
            );
            collected.set(b.pr.number, commits);
            if (info.hasNextPage) {
              b.cursor = str(info.endCursor);
              return true;
            }
            b.commits = commits;
            app.db.put("settings", b.cacheKey, commits);
            return false;
          });
        }
      } else {
        for (const b of batch) {
          const detail = await getPullRequest(
            app,
            b.pr.id,
            true,
            b.p,
            b.eligible,
          );
          if (detail) {
            b.pr = detail;
            b.commits = [...detail.commits];
          }
        }
      }
      for (const b of batch) {
        const previous = app.db.get<PullRequest>("pull_request", b.pr.id);
        const state = checkState(b.p.checkState);
        const pr: PullRequest = {
          ...b.pr,
          mergeMethod:
            b.pr.state === "merged"
              ? previous?.mergeMethod && previous.mergeMethod !== "unknown"
                ? previous.mergeMethod
                : await inferMergeMethod(app, key, b.pr, false)
              : null,
          commitCount: b.commits?.length ?? 0,
          checks:
            forge.kind === "github"
              ? {
                  state,
                  total: state === "none" ? 0 : 1,
                  failed: Number(state === "failure"),
                  pending: Number(state === "pending"),
                }
              : b.pr.checks,
          review:
            forge.kind === "forgejo"
              ? b.pr.review
              : b.p.reviewDecision === "APPROVED"
                ? "approved"
                : b.p.reviewDecision === "CHANGES_REQUESTED"
                  ? "changes_requested"
                  : b.p.reviewDecision === "REVIEW_REQUIRED"
                    ? "review_required"
                    : "none",
        };
        app.db.put("pull_request", pr.id, pr);
        app.db.putCommits(pr.id, b.commits ?? []);
        if (b.eligible && b.commits)
          app.db.put("settings", b.cacheKey, b.commits);
        result.push(pr);
      }
    }
    await rebuildProvenance(app, key);
    const newest = rows
      .map((r) => str(obj(r).updated_at))
      .sort()
      .at(-1);
    if (newest) app.db.put("settings", "pr-sync:" + key, newest);
  }
  return result;
}
export async function createPullRequest(
  app: ApplicationApi,
  input: {
    branchId: string;
    cloneHost?: string;
    base?: string;
    title: string;
    body: string;
    draft: boolean;
  },
) {
  const branch = app.getBranch(input.branchId);
  if (!branch) throw new NotFound({ message: "Branch missing" });
  const repository = app.getRepository(branch.repo);
  const selected = branch.clones
    .filter((c) => !input.cloneHost || c.host === input.cloneHost)
    .map((c) => ({
      branch: c,
      remote: repository.clones
        .find((r) => r.host === c.host && r.path === c.path)
        ?.remotes.find((r) => r.key === branch.repo),
    }))
    .find((c) => c.remote);
  if (!selected?.remote)
    throw new ForgeRejected({
      message:
        "No selected clone has a configured remote for this forge repository",
    });
  const clone = selected.branch,
    remote = selected.remote;
  // The worker rechecks the captured local SHA and the selected remote before pushing.
  const plan = await app.planActions({
    kind: "push-branch",
    targets: [
      {
        host: clone.host,
        repo: clone.path,
        branch: branch.name,
        remote: remote.name,
      },
    ],
  });
  if (plan.some((p) => p.status !== "planned"))
    throw new ForgeRejected({ message: plan.map((p) => p.reason).join("; ") });
  const applied = await app.applyActions(plan.map((p) => p.id));
  if (applied.some((p) => p.status !== "done"))
    throw new ForgeRejected({
      message: applied.map((p) => p.reason).join("; "),
    });
  const raw = await app.forge().operation(branch.repo, "create", {
    head: branch.name,
    base: input.base ?? clone.base?.replace(/^[^/]+\//, "") ?? "main",
    title: input.title,
    body: input.body,
    draft: input.draft,
  });
  return (await getPullRequest(
    app,
    `${branch.repo}!${Number(obj(raw).number)}`,
  ))!;
}
export async function mutatePullRequest(
  app: ApplicationApi,
  id: string,
  operation: "merge" | "close" | "comment",
  input: Record<string, unknown> = {},
) {
  const { repo, number } = parsePrId(id);
  const before = await getPullRequest(app, id);
  if (!before) throw new NotFound({ message: "Pull request missing" });
  const kind = app
    .settings()
    .forges.find((f) => repo.startsWith(f.host + "/"))!.kind;
  const result = await app.forge().operation(repo, operation, {
    number,
    ...input,
    ...(operation === "merge" && input.method !== "rebase"
      ? mergeTrailers(kind, before)
      : {}),
    ...(operation === "merge"
      ? kind === "github"
        ? { merge_method: input.method, sha: before.headSha }
        : {
            Do: input.method,
            head_commit_id: before.headSha,
            delete_branch_after_merge: input.deleteRemoteBranch,
          }
      : {}),
  });
  if (operation === "merge" && obj(result).merged === false)
    throw new ForgeRejected({
      message: str(obj(result).message) || "Merge rejected",
    });
  if (operation === "comment") return { ok: true as const };
  const after = await getPullRequest(app, id);
  if (operation === "merge" && after?.state !== "merged")
    throw new ForgeRejected({ message: "Forge did not confirm merge" });
  if (operation === "merge" && input.deleteRemoteBranch && kind === "github") {
    const [host, ...parts] = repo.split("/");
    await app
      .forge()
      .request(
        host,
        `/repos/${parts.join("/")}/git/refs/heads/${encodeURIComponent(before.head)}`,
        "DELETE",
      );
  }
  return after!;
}

export function mergeTrailers(
  kind: "github" | "forgejo",
  pr: PullRequest & { body?: string },
) {
  const message = `Source-Branch: ${pr.head}\nSource-Head: ${pr.headSha}\nSource-PR: ${pr.url}`;
  const body = pr.body ? `${pr.body}\n\n${message}` : message;
  return kind === "github"
    ? { commit_message: body }
    : { MergeMessageField: `${pr.title}\n\n${body}` };
}
