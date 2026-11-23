/**
 * DBのスキーマ（README「データ設計」）。
 *
 * 日時はすべて UNIX ミリ秒の整数で保存する（Drizzle の timestamp_ms）。
 * 日本時間への変換は src/lib/date.ts で行い、DBにはタイムゾーンを持ち込まない。
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { TaskStatus } from "../lib/sync"; // drizzle-kit から読むので "@/" ではなく相対パス

export const TASK_STATUSES = [
  "todo",
  "done",
  "cancel_pending",
  "dismissed",
] as const satisfies readonly TaskStatus[];

/** 取り込み元のiCalフィード（K-LMS、Googleカレンダー） */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** iCal URL。URL自体が認証トークンなので、DBファイルごとgit管理外にする */
  url: text("url").notNull(),
  /** 最後に同期に成功した日時 */
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
  /** 最後の同期が失敗したときのメッセージ（成功したら空に戻す）。URLは含めない */
  lastSyncError: text("last_sync_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 締切そのもの。フィード由来と手入力の両方を入れる */
export const tasks = sqliteTable(
  "tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 取り込み元。手入力なら空。フィードを削除したら、そのフィード由来の締切も消える */
    sourceId: integer("source_id").references(() => sources.id, { onDelete: "cascade" }),
    /** iCalのUID。再同期で同じ締切を見つけるのに使う。手入力なら空 */
    externalUid: text("external_uid"),
    title: text("title").notNull(),
    deadline: integer("deadline", { mode: "timestamp_ms" }).notNull(),
    /** 所要時間（分）。未入力なら空で「見積もりを入れて」欄に出る */
    estimateMinutes: integer("estimate_minutes"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    /** 「取り消された？」で「残す」を選んだか。true ならフィードから消えていても確認に戻さない */
    kept: integer("kept", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    // 同じフィードに同じUIDは1件だけ（手入力は両方空なので対象外。SQLiteではNULL同士は重複扱いにならない）
    uniqueIndex("tasks_source_uid_unique").on(t.sourceId, t.externalUid),
    index("tasks_status_idx").on(t.status),
    // フィード由来なら source_id と external_uid の両方がある。手入力なら両方空
    check("tasks_source_uid_pair", sql`(${t.sourceId} IS NULL) = (${t.externalUid} IS NULL)`),
    check("tasks_estimate_positive", sql`${t.estimateMinutes} IS NULL OR ${t.estimateMinutes} > 0`),
    check("tasks_status_valid", sql`${t.status} IN ('todo', 'done', 'cancel_pending', 'dismissed')`),
    // 「削除済み」はフィード由来だけ（手入力はDBから消すので、この状態にしない）
    check("tasks_dismissed_from_feed", sql`${t.status} <> 'dismissed' OR ${t.sourceId} IS NOT NULL`),
  ],
);

export type Source = typeof sources.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
