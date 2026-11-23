CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`last_synced_at` integer,
	`last_sync_error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer,
	`external_uid` text,
	`title` text NOT NULL,
	`deadline` integer NOT NULL,
	`estimate_minutes` integer,
	`status` text DEFAULT 'todo' NOT NULL,
	`kept` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tasks_source_uid_pair" CHECK(("tasks"."source_id" IS NULL) = ("tasks"."external_uid" IS NULL)),
	CONSTRAINT "tasks_estimate_positive" CHECK("tasks"."estimate_minutes" IS NULL OR "tasks"."estimate_minutes" > 0),
	CONSTRAINT "tasks_status_valid" CHECK("tasks"."status" IN ('todo', 'done', 'cancel_pending'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_uid_unique` ON `tasks` (`source_id`,`external_uid`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);