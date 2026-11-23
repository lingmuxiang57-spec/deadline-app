/**
 * 締切の書き込み。Server Actions から呼ぶ。
 * 状態の遷移はここで制限する（例: 完了にできるのは未着手だけ）。
 * いずれも対象が見つからない・遷移できないときは false を返す。
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { ESTIMATE_OPTIONS } from "@/lib/priority";
import type { Db } from "./client";
import { tasks } from "./schema";

const ALLOWED_ESTIMATES = new Set<number>(ESTIMATE_OPTIONS.map((o) => o.minutes));

export function addManualTask(db: Db, input: { title: string; deadline: Date }): number {
  return db
    .insert(tasks)
    .values({ title: input.title, deadline: input.deadline })
    .returning({ id: tasks.id })
    .get().id;
}

/** 所要時間は7つの選択肢のどれかだけ受け付ける */
export function setEstimate(db: Db, id: number, minutes: number): boolean {
  if (!ALLOWED_ESTIMATES.has(minutes)) return false;
  return changed(db.update(tasks).set({ estimateMinutes: minutes }).where(eq(tasks.id, id)).run());
}

export function completeTask(db: Db, id: number): boolean {
  return changed(
    db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.id, id), eq(tasks.status, "todo")))
      .run(),
  );
}

/** 完了を取り消して未着手に戻す */
export function reopenTask(db: Db, id: number): boolean {
  return changed(
    db
      .update(tasks)
      .set({ status: "todo" })
      .where(and(eq(tasks.id, id), eq(tasks.status, "done")))
      .run(),
  );
}

/** 「取り消された？」で「残す」。以後フィードになくても確認に戻さない */
export function keepTask(db: Db, id: number): boolean {
  return changed(
    db
      .update(tasks)
      .set({ status: "todo", kept: true })
      .where(and(eq(tasks.id, id), eq(tasks.status, "cancel_pending")))
      .run(),
  );
}

/**
 * 削除できるのは、手入力の締切と「取り消し確認」中の締切だけ。
 * フィードにまだある締切は、消しても次の同期でまた取り込まれるため削除させない。
 */
export function deleteTask(db: Db, id: number): boolean {
  return changed(
    db
      .delete(tasks)
      .where(and(eq(tasks.id, id), or(isNull(tasks.sourceId), eq(tasks.status, "cancel_pending"))))
      .run(),
  );
}

/**
 * リストから「削除」する（未着手のものだけ）。
 *   - 手入力の締切 → DBから消す
 *   - フィード由来の締切 → 「削除済み」にしてリストに出さない。DBには残してUIDで見分け、同期で再び取り込まない
 */
export function dismissTask(db: Db, id: number): boolean {
  return db.transaction((tx) => {
    const task = tx
      .select({ sourceId: tasks.sourceId })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.status, "todo")))
      .get();
    if (!task) return false;
    if (task.sourceId === null) {
      return changed(tx.delete(tasks).where(eq(tasks.id, id)).run());
    }
    return changed(tx.update(tasks).set({ status: "dismissed" }).where(eq(tasks.id, id)).run());
  });
}

/** 「削除済み」を未着手に戻す */
export function restoreTask(db: Db, id: number): boolean {
  return changed(
    db
      .update(tasks)
      .set({ status: "todo" })
      .where(and(eq(tasks.id, id), eq(tasks.status, "dismissed")))
      .run(),
  );
}

function changed(result: { changes: number }): boolean {
  return result.changes > 0;
}
