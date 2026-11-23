PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
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
	CONSTRAINT "tasks_source_uid_pair" CHECK(("__new_tasks"."source_id" IS NULL) = ("__new_tasks"."external_uid" IS NULL)),
	CONSTRAINT "tasks_estimate_positive" CHECK("__new_tasks"."estimate_minutes" IS NULL OR "__new_tasks"."estimate_minutes" > 0),
	CONSTRAINT "tasks_status_valid" CHECK("__new_tasks"."status" IN ('todo', 'done', 'cancel_pending', 'dismissed')),
	CONSTRAINT "tasks_dismissed_from_feed" CHECK("__new_tasks"."status" <> 'dismissed' OR "__new_tasks"."source_id" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "source_id", "external_uid", "title", "deadline", "estimate_minutes", "status", "kept", "created_at", "updated_at") SELECT "id", "source_id", "external_uid", "title", "deadline", "estimate_minutes", "status", "kept", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_source_uid_unique` ON `tasks` (`source_id`,`external_uid`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);