CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`host` text,
	`json` text NOT NULL,
	`updated` text NOT NULL
);
