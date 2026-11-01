CREATE TABLE `branch_history` (
	`repository_id` text,
	`clone_id` text,
	`branch_id` text,
	`worktree_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`number` integer,
	`head_ref` text,
	`head_sha` text,
	`merge_commit_sha` text,
	`merge_method` text,
	`base` text,
	`merged_at` text,
	`verdict` text,
	`last_commit_at` text,
	`stale` integer,
	`dirty` integer,
	`local_only` integer,
	`json` text NOT NULL,
	`updated` text NOT NULL,
	`clone_path` text,
	`branch` text,
	`sha` text,
	`first_seen` text,
	`last_seen` text,
	`gone_at` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clone_id`) REFERENCES `clones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branch_history_tuple_idx` ON `branch_history` (`host`,`clone_path`,`branch`,`sha`);--> statement-breakpoint
CREATE TABLE `landings` (
	`repository_id` text,
	`clone_id` text,
	`branch_id` text,
	`worktree_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`number` integer,
	`head_ref` text,
	`head_sha` text,
	`merge_commit_sha` text,
	`merge_method` text,
	`base` text,
	`merged_at` text,
	`verdict` text,
	`last_commit_at` text,
	`stale` integer,
	`dirty` integer,
	`local_only` integer,
	`json` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clone_id`) REFERENCES `clones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `landings_repo_idx` ON `landings` (`repo`);--> statement-breakpoint
CREATE INDEX `landings_status_idx` ON `landings` (`status`);--> statement-breakpoint
CREATE INDEX `landings_host_idx` ON `landings` (`host`);--> statement-breakpoint
CREATE INDEX `landings_repo_head_idx` ON `landings` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
CREATE TABLE `provenance` (
	`repository_id` text,
	`clone_id` text,
	`branch_id` text,
	`worktree_id` text,
	`id` text PRIMARY KEY NOT NULL,
	`host` text,
	`repo` text,
	`status` text,
	`state` text,
	`name` text,
	`number` integer,
	`head_ref` text,
	`head_sha` text,
	`merge_commit_sha` text,
	`merge_method` text,
	`base` text,
	`merged_at` text,
	`verdict` text,
	`last_commit_at` text,
	`stale` integer,
	`dirty` integer,
	`local_only` integer,
	`json` text NOT NULL,
	`updated` text NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clone_id`) REFERENCES `clones`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`worktree_id`) REFERENCES `worktrees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provenance_repo_idx` ON `provenance` (`repo`);--> statement-breakpoint
CREATE INDEX `provenance_status_idx` ON `provenance` (`status`);--> statement-breakpoint
CREATE INDEX `provenance_host_idx` ON `provenance` (`host`);--> statement-breakpoint
CREATE INDEX `provenance_repo_head_idx` ON `provenance` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
CREATE TABLE `pull_request_commits` (
	`pr_id` text NOT NULL,
	`sha` text NOT NULL,
	`position` integer NOT NULL,
	`subject` text NOT NULL,
	`author` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`pr_id`, `sha`),
	FOREIGN KEY (`pr_id`) REFERENCES `pull_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pr_commits_sha_idx` ON `pull_request_commits` (`sha`);--> statement-breakpoint
ALTER TABLE `actions` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `actions` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `base` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `actions` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `actions` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `actions` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `actions_repo_head_idx` ON `actions` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `base` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `agent_run_events_repo_head_idx` ON `agent_run_events` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `base` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `agent_runs` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `agent_runs_repo_head_idx` ON `agent_runs` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `base` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `branch_clones` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `branch_clones_repo_head_idx` ON `branch_clones` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `branches` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `base` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `branches` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `branches_repo_head_idx` ON `branches` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
CREATE INDEX `branches_verdict_idx` ON `branches` (`repo`,`verdict`,`state`,`last_commit_at`,`stale`,`dirty`,`local_only`);--> statement-breakpoint
ALTER TABLE `classifications` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `classifications` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `base` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `classifications` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `classifications` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `classifications` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `classifications_repo_head_idx` ON `classifications` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `clones` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `clones` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `base` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `clones` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `clones` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `clones` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `clones_repo_head_idx` ON `clones` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `descriptions` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `base` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `descriptions` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `descriptions_repo_head_idx` ON `descriptions` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `base` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `jobs_repo_head_idx` ON `jobs` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `base` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `pull_requests_repo_head_idx` ON `pull_requests` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
CREATE INDEX `pull_requests_updated_idx` ON `pull_requests` (`repo`,`updated`);--> statement-breakpoint
CREATE INDEX `pull_requests_merge_idx` ON `pull_requests` (`repo`,`merge_commit_sha`);--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `base` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `remote_branches` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `remote_branches_repo_head_idx` ON `remote_branches` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `repositories` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `base` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `repositories` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `repositories_repo_head_idx` ON `repositories` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `scans` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `scans` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `base` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `scans` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `scans` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `scans_repo_head_idx` ON `scans` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `settings` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `base` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `settings` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `settings_repo_head_idx` ON `settings` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `stashes` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `stashes` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `base` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `stashes` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `stashes` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `stashes` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `stashes_repo_head_idx` ON `stashes` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `base` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `worktree_files` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `worktree_files_repo_head_idx` ON `worktree_files` (`repo`,`head_ref`,`head_sha`);--> statement-breakpoint
ALTER TABLE `worktrees` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `head_ref` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `head_sha` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `merge_commit_sha` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `merge_method` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `base` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `merged_at` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `last_commit_at` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `stale` integer;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `dirty` integer;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `local_only` integer;--> statement-breakpoint
CREATE INDEX `worktrees_repo_head_idx` ON `worktrees` (`repo`,`head_ref`,`head_sha`);
--> statement-breakpoint
UPDATE pull_requests SET number=json_extract(json,'$.number'), head_ref=json_extract(json,'$.head'), head_sha=json_extract(json,'$.headSha'), base=json_extract(json,'$.base'), merged_at=json_extract(json,'$.mergedAt'), updated=coalesce(json_extract(json,'$.updatedAt'),updated);
