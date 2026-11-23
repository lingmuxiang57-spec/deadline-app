/**
 * 着手期限の計算と「今日やるべき順」の並べ替え。
 * 画面やDBには依存しない純粋な関数だけを置く（README「並べ方のロジック」参照）。
 *
 *   必要日数 = ⌈所要時間（時間）÷ 8⌉
 *   着手期限 = 締切日 − 必要日数
 */

import { type DateKey, addDays, toDateKey } from "./date";

/** 1日に使える作業時間（分）。授業やバイトによる日ごとの差は考慮しない */
export const WORK_MINUTES_PER_DAY = 8 * 60;

/** 所要時間の選択肢（ワンタップ入力用）。DBには minutes を保存する */
export const ESTIMATE_OPTIONS = [
  { label: "30分", minutes: 30 },
  { label: "2時間", minutes: 2 * 60 },
  { label: "半日", minutes: 4 * 60 },
  { label: "1日", minutes: 8 * 60 },
  { label: "2日", minutes: 2 * 8 * 60 },
  { label: "3日", minutes: 3 * 8 * 60 },
  { label: "1週間", minutes: 7 * 8 * 60 },
] as const;

export interface PrioritizableTask {
  /** 締切の日時 */
  deadline: Date;
  /** 所要時間（分）。未入力なら null */
  estimateMinutes: number | null;
}

export interface PrioritizedTask<T> {
  task: T;
  /** 締切日（日本時間） */
  deadlineDate: DateKey;
  /** 作業に必要な日数 */
  requiredDays: number;
  /** この日までに着手する（日本時間） */
  startBy: DateKey;
}

export interface PrioritizedList<T> {
  /** 着手期限が今日以前のもの。着手期限が早い順 */
  today: PrioritizedTask<T>[];
  /** 着手期限が明日以降のもの。着手期限が早い順 */
  upcoming: PrioritizedTask<T>[];
  /** 所要時間が未入力のもの。順位は付けず、締切が早い順に並べるだけ */
  needsEstimate: T[];
}

/** 所要時間（分）から必要日数を出す。締切日当日は作業日に数えない */
export function requiredDays(estimateMinutes: number): number {
  if (!Number.isFinite(estimateMinutes) || estimateMinutes <= 0) {
    throw new RangeError(`所要時間は正の数で指定してください: ${estimateMinutes}`);
  }
  return Math.ceil(estimateMinutes / WORK_MINUTES_PER_DAY);
}

/** 締切と所要時間から着手期限（日本時間の暦日）を出す */
export function startByDate(deadline: Date, estimateMinutes: number): DateKey {
  return addDays(toDateKey(deadline), -requiredDays(estimateMinutes));
}

/**
 * 締切を「今日やる」「これから」「見積もりを入れて」に分けて並べる。
 * 完了や取り消し確認の締切を除くのは呼び出し側の責任（ここでは状態を見ない）。
 *
 * 並び順: 着手期限が早い順 → 締切が早い順 → 所要時間が長い順
 */
export function prioritize<T extends PrioritizableTask>(
  tasks: readonly T[],
  now: Date,
): PrioritizedList<T> {
  const todayKey = toDateKey(now);
  const estimated: PrioritizedTask<T>[] = [];
  const needsEstimate: T[] = [];

  for (const task of tasks) {
    const deadlineDate = toDateKey(task.deadline); // 不正な日時はここでエラーになる
    if (task.estimateMinutes === null) {
      needsEstimate.push(task);
      continue;
    }
    const days = requiredDays(task.estimateMinutes);
    estimated.push({
      task,
      deadlineDate,
      requiredDays: days,
      startBy: addDays(deadlineDate, -days),
    });
  }

  estimated.sort(
    (a, b) =>
      compareKeys(a.startBy, b.startBy) ||
      a.task.deadline.getTime() - b.task.deadline.getTime() ||
      (b.task.estimateMinutes ?? 0) - (a.task.estimateMinutes ?? 0),
  );
  needsEstimate.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  return {
    today: estimated.filter((t) => t.startBy <= todayKey),
    upcoming: estimated.filter((t) => t.startBy > todayKey),
    needsEstimate,
  };
}

function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
