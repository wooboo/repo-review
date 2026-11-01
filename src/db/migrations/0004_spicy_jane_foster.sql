CREATE TABLE `deleted_repositories` (
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
CREATE INDEX `deleted_repositories_repo_idx` ON `deleted_repositories` (`repo`);--> statement-breakpoint
CREATE INDEX `deleted_repositories_status_idx` ON `deleted_repositories` (`status`);--> statement-breakpoint
CREATE INDEX `deleted_repositories_host_idx` ON `deleted_repositories` (`host`);--> statement-breakpoint
CREATE INDEX `deleted_repositories_repo_head_idx` ON `deleted_repositories` (`repo`,`head_ref`,`head_sha`);