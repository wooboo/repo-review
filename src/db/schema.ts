import {
  sqliteTable,
  text,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
const entity = (name: string) =>
  sqliteTable(
    name,
    {
      repositoryId: text("repository_id").references(
        (): AnySQLiteColumn => repositories.id,
        { onDelete: "cascade" },
      ),
      cloneId: text("clone_id").references((): AnySQLiteColumn => clones.id, {
        onDelete: "cascade",
      }),
      branchId: text("branch_id").references(
        (): AnySQLiteColumn => branches.id,
        { onDelete: "cascade" },
      ),
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
      json: text("json").notNull(),
      updated: text("updated").notNull(),
    },
    (t) => [
      index(name + "_repo_idx").on(t.repo),
      index(name + "_status_idx").on(t.status),
      index(name + "_host_idx").on(t.host),
    ],
  );
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
