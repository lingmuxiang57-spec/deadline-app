/**
 * 画面表示用の読み出し。
 */
import { asc, count, eq } from "drizzle-orm";
import { jstDateTime, toDateKey } from "@/lib/date";
import type { Db } from "./client";
import { type Source, type Task, sources, tasks } from "./schema";

export type TaskWithSource = Task & { sourceName: string | null };

export interface TaskBoard {
  /** 未着手（「今日やる」「これから」「見積もりを入れて」に分ける元） */
  open: TaskWithSource[];
  /** フィードから消えた締切（「取り消された？」） */
  cancelPending: TaskWithSource[];
  /** 今日（日本時間）完了にしたもの。押し間違いを戻せるように出す */
  doneToday: TaskWithSource[];
  /** 自分で「削除」したフィード由来の締切。押し間違いを戻せるように出す */
  dismissed: TaskWithSource[];
}

export function getTaskBoard(db: Db, now: Date): TaskBoard {
  const rows = db
    .select({ task: tasks, sourceName: sources.name })
    .from(tasks)
    .leftJoin(sources, eq(tasks.sourceId, sources.id))
    .orderBy(asc(tasks.deadline))
    .all()
    .map(({ task, sourceName }) => ({ ...task, sourceName }));

  const startOfToday = jstDateTime(toDateKey(now), { hour: 0, minute: 0 });
  return {
    open: rows.filter((t) => t.status === "todo"),
    cancelPending: rows.filter((t) => t.status === "cancel_pending"),
    doneToday: rows.filter((t) => t.status === "done" && t.updatedAt >= startOfToday),
    // 締切が過ぎたものは戻す必要がないので出さない
    dismissed: rows.filter((t) => t.status === "dismissed" && t.deadline >= now),
  };
}

export function getSources(db: Db): Source[] {
  return db.select().from(sources).orderBy(asc(sources.id)).all();
}

export type SourceWithCount = Source & { taskCount: number };

/** 登録画面用。削除するとき一緒に消える締切の件数を添える */
export function getSourcesWithTaskCount(db: Db): SourceWithCount[] {
  return db
    .select({ source: sources, taskCount: count(tasks.id) })
    .from(sources)
    .leftJoin(tasks, eq(tasks.sourceId, sources.id))
    .groupBy(sources.id)
    .orderBy(asc(sources.id))
    .all()
    .map(({ source, taskCount }) => ({ ...source, taskCount }));
}
