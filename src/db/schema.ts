import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
const entityColumns = () => ({
  repositoryId: text("repository_id").references(
    (): AnySQLiteColumn => repositories.id,
    { onDelete: "cascade" },
  ),
  cloneId: text("clone_id").references((): AnySQLiteColumn => clones.id, {
    onDelete: "cascade",
  }),
  branchId: text("branch_id").references((): AnySQLiteColumn => branches.id, {
    onDelete: "cascade",
  }),
  worktreeId: text("worktree_id").references(
    (): AnySQLiteColumn => worktrees.id,
    { onDelete: "cascade" },
  ),
  id: text("id").primaryKey(),
  host: text("host"),
  repo: text("repo"),
  status: text("status"),
  state: text("state"),
  name: text("name"),
  number: integer("number"),
  headRef: text("head_ref"),
  headSha: text("head_sha"),
  mergeCommitSha: text("merge_commit_sha"),
  mergeMethod: text("merge_method"),
  base: text("base"),
  mergedAt: text("merged_at"),
  verdict: text("verdict"),
  lastCommitAt: text("last_commit_at"),
  stale: integer("stale"),
  dirty: integer("dirty"),
  localOnly: integer("local_only"),
  json: text("json").notNull(),
  updated: text("updated").notNull(),
});
const entity = (name: string) =>
  sqliteTable(name, entityColumns(), (t) => [
    index(name + "_repo_idx").on(t.repo),
    index(name + "_status_idx").on(t.status),
    index(name + "_host_idx").on(t.host),
    index(name + "_repo_head_idx").on(t.repo, t.headRef, t.headSha),
    ...(name === "branches"
      ? [
          index("branches_verdict_idx").on(
            t.repo,
            t.verdict,
            t.state,
            t.lastCommitAt,
            t.stale,
            t.dirty,
            t.localOnly,
          ),
        ]
      : []),
    ...(name === "pull_requests"
      ? [
          index("pull_requests_updated_idx").on(t.repo, t.updated),
          index("pull_requests_merge_idx").on(t.repo, t.mergeCommitSha),
        ]
      : []),
  ]);
export const repositories = entity("repositories");
export const clones = entity("clones");
export const branches = entity("branches");
export const branchClones = entity("branch_clones");
export const remoteBranches = entity("remote_branches");
export const worktrees = entity("worktrees");
export const worktreeFiles = entity("worktree_files");
export const stashes = entity("stashes");
export const pullRequests = entity("pull_requests");
export const actions = entity("actions");
export const agentRuns = entity("agent_runs");
export const agentRunEvents = entity("agent_run_events");
export const scans = entity("scans");
export const jobs = entity("jobs");
export const descriptions = entity("descriptions");
export const classifications = entity("classifications");
export const settings = entity("settings");

export const branchHistory = sqliteTable(
  "branch_history",
  {
    ...entityColumns(),
    clonePath: text("clone_path"),
    branch: text("branch"),
    sha: text("sha"),
    firstSeen: text("first_seen"),
    lastSeen: text("last_seen"),
    goneAt: text("gone_at"),
  },
  (t) => [
    index("branch_history_tuple_idx").on(t.host, t.clonePath, t.branch, t.sha),
  ],
);
export const provenance = entity("provenance");
export const landings = entity("landings");

export const pullRequestCommits = sqliteTable(
  "pull_request_commits",
  {
    prId: text("pr_id")
      .notNull()
      .references(() => pullRequests.id, { onDelete: "cascade" }),
    sha: text("sha").notNull(),
    position: integer("position").notNull(),
    subject: text("subject").notNull(),
    author: text("author").notNull(),
    at: text("at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.prId, t.sha] }),
    index("pr_commits_sha_idx").on(t.sha),
  ],
);

export const deletedRepositories = entity("deleted_repositories");
