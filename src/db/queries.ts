/**
 * 画面表示用の読み出し。
 */
import { asc, eq } from "drizzle-orm";
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
  };
}

export function getSources(db: Db): Source[] {
  return db.select().from(sources).orderBy(asc(sources.id)).all();
}
