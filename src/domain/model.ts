import { Schema } from "effect";
export const State = Schema.Literals([
  "base",
  "merged",
  "patch-merged",
  "squash-merged",
  "content-in-base",
  "unmerged",
  "no-base",
]);
export type State = typeof State.Type;
export const Verdict = Schema.Literals([
  "base",
  "delete",
  "check",
  "pr-open",
  "local-only",
  "pr-closed",
  "pr-merged-changed",
  "unmerged",
]);
export type Verdict = typeof Verdict.Type;
export const Host = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["local", "ssh"]),
  target: Schema.optional(Schema.String),
  bun: Schema.optional(Schema.String),
  roots: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
});
export type Host = typeof Host.Type;
export const Forge = Schema.Struct({
  host: Schema.String,
  kind: Schema.Literals(["github", "forgejo"]),
  tokenEnv: Schema.optional(Schema.String),
  tokenCommand: Schema.optional(Schema.String),
});
export type Forge = typeof Forge.Type;
export const Agent = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  kind: Schema.Literals(["cli", "acp"]),
  command: Schema.String,
  args: Schema.Array(Schema.String),
  models: Schema.Array(Schema.String),
  defaultModel: Schema.String,
});
export type Agent = typeof Agent.Type;
export const Settings = Schema.Struct({
  hosts: Schema.Array(Host),
  forges: Schema.Array(Forge),
  agents: Schema.Array(Agent),
  staleDays: Schema.Number,
  worktreeDir: Schema.String,
  dailyScanTime: Schema.String,
});
export type Settings = typeof Settings.Type;
export const Thread = Schema.Struct({
  id: Schema.String,
  branch: Schema.NullOr(Schema.String),
  worktree: Schema.NullOr(Schema.String),
  projectRoot: Schema.NullOr(Schema.String),
  title: Schema.String,
  status: Schema.String,
});
export type Thread = typeof Thread.Type;
export const FileChange = Schema.Struct({
  path: Schema.String,
  xy: Schema.String,
  mtime: Schema.NullOr(Schema.String),
});
export const Worktree = Schema.Struct({
  path: Schema.String,
  head: Schema.String,
  branch: Schema.NullOr(Schema.String),
  main: Schema.Boolean,
  exists: Schema.Boolean,
  locked: Schema.Boolean,
  prunable: Schema.Boolean,
  detached: Schema.Boolean,
  operations: Schema.Array(Schema.String),
  submodules: Schema.Array(Schema.String),
  dirty: Schema.Boolean,
  files: Schema.Array(FileChange),
  total: Schema.Number,
  staged: Schema.Number,
  unstaged: Schema.Number,
  untracked: Schema.Number,
  conflicts: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export type Worktree = typeof Worktree.Type;
export const Divergence = Schema.Struct({
  ahead: Schema.Number,
  behind: Schema.Number,
});
export const Branch = Schema.Struct({
  name: Schema.String,
  sha: Schema.String,
  date: Schema.String,
  author: Schema.String,
  subject: Schema.String,
  upstream: Schema.String,
  upstreamGone: Schema.Boolean,
  onRemotes: Schema.Record(Schema.String, Schema.String),
  unpushed: Schema.Number,
  unique: Schema.Number,
  base: Schema.NullOr(Schema.String),
  baseSha: Schema.NullOr(Schema.String),
  mergeBase: Schema.NullOr(Schema.String),
  vsBases: Schema.Record(Schema.String, Divergence),
  ahead: Schema.Number,
  behind: Schema.Number,
  state: State,
  squashCommit: Schema.NullOr(Schema.String),
  containedIn: Schema.Array(Schema.String),
  commits: Schema.Array(Schema.String),
  diffstat: Schema.String,
  residual: Schema.String,
});
export type Branch = typeof Branch.Type;
export const Remote = Schema.Struct({
  name: Schema.String,
  url: Schema.String,
  pushurl: Schema.String,
  key: Schema.String,
  defaultBranch: Schema.String,
  fetchError: Schema.NullOr(Schema.String),
});
export const Clone = Schema.Struct({
  path: Schema.String,
  commonDir: Schema.String,
  name: Schema.String,
  key: Schema.String,
  roots: Schema.Array(Schema.String),
  remotes: Schema.Array(Remote),
  bases: Schema.Array(Schema.String),
  branches: Schema.Array(Branch),
  remoteBranches: Schema.Array(Branch),
  worktrees: Schema.Array(Worktree),
  stashes: Schema.Array(Schema.String),
  threads: Schema.Array(Thread),
  about: Schema.String,
  errors: Schema.Array(Schema.String),
});
export type Clone = typeof Clone.Type;
export const Snapshot = Schema.Struct({
  version: Schema.Literal(1),
  host: Schema.String,
  finished: Schema.String,
  repositories: Schema.Array(Clone),
  errors: Schema.Array(Schema.String),
});
export type Snapshot = typeof Snapshot.Type;
export const Action = Schema.Struct({
  id: Schema.String,
  host: Schema.String,
  repo: Schema.String,
  branch: Schema.String,
  sha: Schema.String,
  base: Schema.String,
  baseSha: Schema.String,
  state: State,
  archive: Schema.Boolean,
  remote: Schema.String,
});
export type Action = typeof Action.Type;
export const ActionResult = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals([
    "planned",
    "running",
    "done",
    "skipped",
    "blocked",
    "failed",
  ]),
  reason: Schema.String,
  restore: Schema.String,
});
export type ActionResult = typeof ActionResult.Type;
export const ScanInput = Schema.Struct({
  hosts: Schema.Array(Schema.String),
  fetch: Schema.Boolean,
});
export const IdInput = Schema.Struct({ id: Schema.String });
export const ListInput = Schema.Struct({
  text: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  verdict: Schema.optional(Verdict),
  state: Schema.optional(State),
  stale: Schema.optional(Schema.Boolean),
  dirty: Schema.optional(Schema.Boolean),
  localOnly: Schema.optional(Schema.Boolean),
  sort: Schema.optional(Schema.Literals(["name", "date"])),
  page: Schema.optional(Schema.Number),
  pageSize: Schema.optional(Schema.Number),
});
export type ListInput = typeof ListInput.Type;
export function searchParams(input: unknown) {
  const p = Schema.decodeUnknownSync(ListInput)(input);
  return {
    ...p,
    text: p.text ?? "",
    sort: p.sort ?? "name",
    page: Math.max(1, Math.floor(p.page ?? 1)),
    pageSize: Math.max(1, Math.min(200, Math.floor(p.pageSize ?? 50))),
  };
}
export function stripDefaults(input: unknown) {
  const p = searchParams(input);
  return Object.fromEntries(
    Object.entries(p).filter(
      ([k, v]) =>
        !(
          (k === "text" && v === "") ||
          (k === "sort" && v === "name") ||
          (k === "page" && v === 1) ||
          (k === "pageSize" && v === 50)
        ),
    ),
  );
}
