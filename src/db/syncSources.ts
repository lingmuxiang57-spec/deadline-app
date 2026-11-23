/**
 * iCalフィードを同期してDBに反映する。
 *
 * 取得（非同期・時間がかかる）はトランザクションの外で行い、
 * DBの読み出し → 照合（planSync） → 書き込み は1つのトランザクションでまとめて行う。
 * 1つのフィードの失敗で他のフィードや画面表示を止めないよう、失敗は sources.last_sync_error に記録して返す。
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { type FetchIcsOptions, SyncError, type SyncedTask, fetchIcs, parseIcs, planSync } from "@/lib/sync";
import type { Db } from "./client";
import { sources, tasks } from "./schema";

export type SyncResult =
  | { sourceId: number; ok: true; inserted: number; updated: number; markedForCancel: number }
  | { sourceId: number; ok: false; error: string };

const UNEXPECTED_ERROR = "同期中に予期しないエラーが発生しました";

export async function syncSource(
  db: Db,
  sourceId: number,
  now: Date = new Date(),
  fetchOptions?: FetchIcsOptions,
): Promise<SyncResult> {
  const source = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) {
    throw new Error(`フィードが見つかりません: id=${sourceId}`);
  }

  let events;
  try {
    events = parseIcs(await fetchIcs(source.url, fetchOptions));
  } catch (error) {
    // SyncError 以外のメッセージにはURLが混ざるおそれがあるので、そのまま出さない
    const message = error instanceof SyncError ? error.message : UNEXPECTED_ERROR;
    db.update(sources).set({ lastSyncError: message }).where(eq(sources.id, sourceId)).run();
    return { sourceId, ok: false, error: message };
  }

  return db.transaction((tx) => {
    const existing: SyncedTask[] = tx
      .select({
        id: tasks.id,
        externalUid: tasks.externalUid,
        title: tasks.title,
        deadline: tasks.deadline,
        status: tasks.status,
        kept: tasks.kept,
      })
      .from(tasks)
      .where(and(eq(tasks.sourceId, sourceId), isNotNull(tasks.externalUid)))
      .all()
      .map((row) => ({ ...row, externalUid: row.externalUid! }));

    const plan = planSync(existing, events, now);

    if (plan.inserts.length > 0) {
      tx.insert(tasks)
        .values(
          plan.inserts.map((event) => ({
            sourceId,
            externalUid: event.externalUid,
            title: event.title,
            deadline: event.deadline,
          })),
        )
        .run();
    }
    for (const update of plan.updates) {
      tx.update(tasks).set(update.changes).where(eq(tasks.id, update.id)).run();
    }
    tx.update(sources)
      .set({ lastSyncedAt: now, lastSyncError: null })
      .where(eq(sources.id, sourceId))
      .run();

    return {
      sourceId,
      ok: true as const,
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      markedForCancel: plan.updates.filter((u) => u.changes.status === "cancel_pending").length,
    };
  });
}

/** 画面を開いたときの自動同期で、同じフィードを取りに行く最短間隔 */
export const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;

// 失敗した試行も数えるため、最終同期日時（成功時のみ）とは別にプロセス内で覚えておく
const globalForSync = globalThis as unknown as { __deadlineSyncAttempts?: Map<number, number> };
const lastAttempts = (globalForSync.__deadlineSyncAttempts ??= new Map());

/**
 * 前回の試行から minIntervalMs 以上たったフィードだけ同期する。
 * 完了チェックなどのたびに画面が再描画されるので、そのたびにフィードを取りに行かないようにする。
 */
export async function syncStaleSources(
  db: Db,
  now: Date = new Date(),
  options: { minIntervalMs?: number; fetchOptions?: FetchIcsOptions } = {},
): Promise<SyncResult[]> {
  const { minIntervalMs = AUTO_SYNC_INTERVAL_MS, fetchOptions } = options;
  const due = db
    .select({ id: sources.id })
    .from(sources)
    .all()
    .filter(({ id }) => now.getTime() - (lastAttempts.get(id) ?? -Infinity) >= minIntervalMs);

  for (const { id } of due) lastAttempts.set(id, now.getTime());
  return Promise.all(due.map(({ id }) => syncSource(db, id, now, fetchOptions)));
}

/** テスト用: 試行の記録を消す */
export function resetSyncAttempts(): void {
  lastAttempts.clear();
}

/** 登録されているすべてのフィードを同期する（取得は並行して行う） */
export async function syncAllSources(
  db: Db,
  now: Date = new Date(),
  fetchOptions?: FetchIcsOptions,
): Promise<SyncResult[]> {
  const ids = db.select({ id: sources.id }).from(sources).all();
  for (const { id } of ids) lastAttempts.set(id, now.getTime());
  return Promise.all(ids.map(({ id }) => syncSource(db, id, now, fetchOptions)));
}
