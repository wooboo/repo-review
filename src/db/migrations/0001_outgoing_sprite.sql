CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actions_repo_idx` ON `actions` (`repo`);--> statement-breakpoint
CREATE INDEX `actions_status_idx` ON `actions` (`status`);--> statement-breakpoint
CREATE INDEX `actions_host_idx` ON `actions` (`host`);--> statement-breakpoint
CREATE TABLE `agent_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_run_events_repo_idx` ON `agent_run_events` (`repo`);--> statement-breakpoint
CREATE INDEX `agent_run_events_status_idx` ON `agent_run_events` (`status`);--> statement-breakpoint
CREATE INDEX `agent_run_events_host_idx` ON `agent_run_events` (`host`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_runs_repo_idx` ON `agent_runs` (`repo`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_idx` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE INDEX `agent_runs_host_idx` ON `agent_runs` (`host`);--> statement-breakpoint
CREATE TABLE `branch_clones` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `branch_clones_repo_idx` ON `branch_clones` (`repo`);--> statement-breakpoint
CREATE INDEX `branch_clones_status_idx` ON `branch_clones` (`status`);--> statement-breakpoint
CREATE INDEX `branch_clones_host_idx` ON `branch_clones` (`host`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `branches_repo_idx` ON `branches` (`repo`);--> statement-breakpoint
CREATE INDEX `branches_status_idx` ON `branches` (`status`);--> statement-breakpoint
CREATE INDEX `branches_host_idx` ON `branches` (`host`);--> statement-breakpoint
CREATE TABLE `classifications` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `classifications_repo_idx` ON `classifications` (`repo`);--> statement-breakpoint
CREATE INDEX `classifications_status_idx` ON `classifications` (`status`);--> statement-breakpoint
CREATE INDEX `classifications_host_idx` ON `classifications` (`host`);--> statement-breakpoint
CREATE TABLE `clones` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clones_repo_idx` ON `clones` (`repo`);--> statement-breakpoint
CREATE INDEX `clones_status_idx` ON `clones` (`status`);--> statement-breakpoint
CREATE INDEX `clones_host_idx` ON `clones` (`host`);--> statement-breakpoint
CREATE TABLE `descriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `descriptions_repo_idx` ON `descriptions` (`repo`);--> statement-breakpoint
CREATE INDEX `descriptions_status_idx` ON `descriptions` (`status`);--> statement-breakpoint
CREATE INDEX `descriptions_host_idx` ON `descriptions` (`host`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_repo_idx` ON `jobs` (`repo`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_host_idx` ON `jobs` (`host`);--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pull_requests_repo_idx` ON `pull_requests` (`repo`);--> statement-breakpoint
CREATE INDEX `pull_requests_status_idx` ON `pull_requests` (`status`);--> statement-breakpoint
CREATE INDEX `pull_requests_host_idx` ON `pull_requests` (`host`);--> statement-breakpoint
CREATE TABLE `remote_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `remote_branches_repo_idx` ON `remote_branches` (`repo`);--> statement-breakpoint
CREATE INDEX `remote_branches_status_idx` ON `remote_branches` (`status`);--> statement-breakpoint
CREATE INDEX `remote_branches_host_idx` ON `remote_branches` (`host`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repositories_repo_idx` ON `repositories` (`repo`);--> statement-breakpoint
CREATE INDEX `repositories_status_idx` ON `repositories` (`status`);--> statement-breakpoint
CREATE INDEX `repositories_host_idx` ON `repositories` (`host`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scans_repo_idx` ON `scans` (`repo`);--> statement-breakpoint
CREATE INDEX `scans_status_idx` ON `scans` (`status`);--> statement-breakpoint
CREATE INDEX `scans_host_idx` ON `scans` (`host`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settings_repo_idx` ON `settings` (`repo`);--> statement-breakpoint
CREATE INDEX `settings_status_idx` ON `settings` (`status`);--> statement-breakpoint
CREATE INDEX `settings_host_idx` ON `settings` (`host`);--> statement-breakpoint
CREATE TABLE `stashes` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stashes_repo_idx` ON `stashes` (`repo`);--> statement-breakpoint
CREATE INDEX `stashes_status_idx` ON `stashes` (`status`);--> statement-breakpoint
CREATE INDEX `stashes_host_idx` ON `stashes` (`host`);--> statement-breakpoint
CREATE TABLE `worktree_files` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `worktree_files_repo_idx` ON `worktree_files` (`repo`);--> statement-breakpoint
CREATE INDEX `worktree_files_status_idx` ON `worktree_files` (`status`);--> statement-breakpoint
CREATE INDEX `worktree_files_host_idx` ON `worktree_files` (`host`);--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `worktrees_repo_idx` ON `worktrees` (`repo`);--> statement-breakpoint
CREATE INDEX `worktrees_status_idx` ON `worktrees` (`status`);--> statement-breakpoint
CREATE INDEX `worktrees_host_idx` ON `worktrees` (`host`);--> statement-breakpoint
INSERT INTO settings (id, host, json, updated) SELECT id, host, json, updated FROM records WHERE kind = 'settings';
--> statement-breakpoint
DROP TABLE `records`;