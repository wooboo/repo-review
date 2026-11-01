/**
 * Pure mappers from the provisional backend results (docs/API.md, first part) to the
 * Contract v2 shapes in ./types. Every function here is a TODO(contract-v2) adapter:
 * delete it once the backend returns the v2 shapes directly.
 */
import type {
  ActionStatus,
  AgentEvent,
  AgentEventKind,
  AgentRun,
  AgentRunStatus,
  Job,
  JobStatus,
  PlannedAction,
  PullRequest,
  PullRequestDetail,
  ReviewState,
  State,
} from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const DIFF_LIMIT = 500_000;

export const pullRequestId = (repo: string, number: number) => `${repo}!${number}`;
export function parsePullRequestId(id: string): { repo: string; number: number } | null {
  const i = id.lastIndexOf("!");
  const number = Number(id.slice(i + 1));
  return i > 0 && Number.isInteger(number) && number > 0 ? { repo: id.slice(0, i), number } : null;
}
export const branchId = (repo: string, name: string) => `${repo}#${name}`;
export function parseBranchId(id: string): { repo: string; name: string } | null {
  const i = id.indexOf("#");
  return i > 0 ? { repo: id.slice(0, i), name: id.slice(i + 1) } : null;
}

// TODO(contract-v2): the backend maps forge payloads to PullRequest itself.
export function mapPullRequest(raw: unknown, repo: string, forge: "github" | "forgejo"): PullRequest {
  const p = obj(raw);
  const head = obj(p.head);
  const base = obj(p.base);
  const mergedAt = str(p.merged_at) || null;
  const merged = mergedAt !== null || p.merged === true || p.state === "merged";
  const number = num(p.number);
  const headRef = str(head.ref);
  return {
    id: pullRequestId(repo, number),
    repo,
    forge,
    number,
    title: str(p.title),
    url: str(p.html_url) || str(p.url),
    author: str(obj(p.user).login),
    state: merged ? "merged" : p.state === "open" ? "open" : "closed",
    draft: p.draft === true,
    head: headRef,
    headSha: str(head.sha),
    base: str(base.ref),
    branchId: headRef ? branchId(repo, headRef) : null,
    createdAt: str(p.created_at),
    updatedAt: str(p.updated_at),
    mergedAt,
    checks: { state: "none", total: 0, failed: 0, pending: 0 },
    review: "none",
    mergeable: typeof p.mergeable === "boolean" ? p.mergeable : null,
  };
}

/** Latest review per author decides: any "changes requested" wins over approvals. */
export function reviewSummary(reviews: readonly { author: string; state: string }[]): ReviewState {
  const latest = new Map<string, string>();
  for (const r of reviews) if (!/comment/i.test(r.state)) latest.set(r.author, r.state.toUpperCase());
  const states = [...latest.values()];
  if (states.some((s) => s === "CHANGES_REQUESTED" || s === "REQUEST_CHANGES")) return "changes_requested";
  if (states.some((s) => s === "APPROVED")) return "approved";
  if (states.some((s) => s === "REQUEST_REVIEW" || s === "PENDING")) return "review_required";
  return "none";
}

// TODO(contract-v2): getPullRequest returns PullRequestDetail.
export function mapPullRequestDetail(raw: unknown, repo: string, forge: "github" | "forgejo"): PullRequestDetail {
  const d = obj(raw);
  const base = mapPullRequest(d.pull, repo, forge);
  const reviews = arr(d.reviews).map((r) => {
    const o = obj(r);
    return { author: str(obj(o.user).login), state: str(o.state), body: str(o.body), at: str(o.submitted_at) };
  });
  const diff = str(d.diff);
  return {
    ...base,
    review: reviewSummary(reviews),
    body: str(obj(d.pull).body),
    files: arr(d.files).map((f) => {
      const o = obj(f);
      return { path: str(o.filename), status: str(o.status), additions: num(o.additions), deletions: num(o.deletions) };
    }),
    diff: diff.slice(0, DIFF_LIMIT),
    diffTruncated: diff.length > DIFF_LIMIT,
    checkRuns: [],
    reviews: reviews.filter((r) => r.body || !/comment/i.test(r.state)),
    comments: [],
  };
}

// TODO(contract-v2): jobs are typed per kind on the server.
export function mapJob<T>(raw: unknown, result: (value: unknown) => T): Job<T> {
  const j = obj(raw);
  const status: JobStatus = j.status === "done" ? "done" : j.status === "failed" ? "failed" : "running";
  return {
    id: str(j.id),
    status,
    result: status === "done" ? result(j.result) : null,
    error: typeof j.error === "string" ? j.error : null,
  };
}

const actionStatuses: readonly ActionStatus[] = ["planned", "skipped", "blocked", "running", "done", "failed"];

// TODO(contract-v2): listActions/planActions return PlannedAction.
export function mapAction(raw: unknown, keyForPath: (host: string, path: string) => string | undefined): PlannedAction {
  const a = obj(raw);
  const host = str(a.host);
  const repo = str(a.repo);
  const branch = str(a.branch);
  const repoKey = keyForPath(host, repo) ?? "";
  const status = actionStatuses.find((s) => s === a.status) ?? "failed";
  return {
    id: str(a.id),
    kind: a.archive === true ? "archive-and-delete" : "delete-branch",
    target: { host, repo, branch, remote: str(a.remote) || undefined },
    branchId: repoKey && branch ? branchId(repoKey, branch) : null,
    repoKey,
    status,
    reason: str(a.reason),
    restore: str(a.restore) || null,
    createdAt: str(a.createdAt),
    finishedAt: str(a.finishedAt) || null,
  };
}

const runStatuses: readonly AgentRunStatus[] = ["queued", "running", "done", "failed", "cancelled"];

// TODO(contract-v2): AgentRun is stored in the v2 shape.
export function mapAgentRun(raw: unknown, keyForPath: (path: string) => string | undefined): AgentRun {
  const r = obj(raw);
  const repoPath = str(r.repo);
  const repo = keyForPath(repoPath) ?? repoPath;
  const branch = str(r.branch);
  const task = str(r.task);
  return {
    id: str(r.id),
    agentId: str(r.agent) || str(r.agentId),
    model: str(r.model),
    task:
      task === "review-branch" || task === "make-pr" || task === "review-pr" || task === "cleanup-repo" || task === "describe-repo"
        ? task
        : "custom",
    repo,
    branchId: branch ? branchId(repo, branch) : null,
    pullRequestId: null,
    cwd: str(r.cwd),
    status: runStatuses.find((s) => s === r.status) ?? "failed",
    summary: str(r.summary) || null,
    costUsd: null,
    pullRequestUrl: null,
    startedAt: str(r.started) || str(r.startedAt),
    finishedAt: str(r.finished) || str(r.finishedAt) || null,
  };
}

function textOf(content: unknown): string {
  const c = obj(content);
  if (typeof c.text === "string") return c.text;
  if (Array.isArray(content)) return content.map(textOf).join("");
  if (c.content !== undefined) return textOf(c.content);
  return "";
}

// TODO(contract-v2): AgentEvent is produced by the runner.
export function mapAgentEvent(raw: unknown, seq: number): AgentEvent {
  const e = obj(raw);
  const at = str(e.at);
  const ev = obj(e.event);
  const make = (kind: AgentEventKind, text: string): AgentEvent => ({ seq, at, kind, text });
  if (ev.type === "stdout") return make("message", str(ev.text));
  if (ev.type === "stderr") return make("status", str(ev.text));
  if (ev.type === "error") return make("error", str(ev.message) || str(ev.text));
  if (ev.toolCall && ev.options) return make("permission", str(obj(ev.toolCall).title) || "Permission requested");
  const update = obj(ev.update);
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return make("message", textOf(update.content));
    case "agent_thought_chunk":
      return make("thought", textOf(update.content));
    case "tool_call":
    case "tool_call_update":
      return make("tool", [str(update.title), str(update.status)].filter(Boolean).join(" · ") || str(update.toolCallId));
    default:
      if (typeof ev.stopReason === "string") return make("status", `Stopped: ${ev.stopReason}`);
      return make("status", str(update.sessionUpdate) || JSON.stringify(ev).slice(0, 300));
  }
}

/** Consecutive message/thought chunks are merged so the stream reads as text, not tokens. */
export function mergeChunks(events: readonly AgentEvent[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (last && (e.kind === "message" || e.kind === "thought") && last.kind === e.kind) out[out.length - 1] = { ...last, text: last.text + e.text };
    else out.push(e);
  }
  return out;
}

export const isIntegratedState = (s: State) => s === "merged" || s === "patch-merged" || s === "squash-merged" || s === "content-in-base";
