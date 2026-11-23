/**
 * カレンダー（タイムライン）の配置計算。画面には依存しない。
 *
 * 横軸は今日から days 日分の日付。1行が1つの締切で、
 *   帯 … 着手すべき日 〜 締切の前日（＝必要日数ぶん。締切日当日は作業日に数えない）
 *   ◆  … 締切日
 * 範囲の外にはみ出す部分は切り詰め、切り詰めたことを clippedStart / clippedEnd で返す。
 *
 * この画面で完了や見積もりの操作もするので、範囲より後に始まる締切も行として返す（afterRange）。
 * 行は「今日やる」「見積もりを入れて」「これから」の3つのまとまり（group）に分け、この順に並べる。
 */
import { type DateKey, addDays, diffDays, toDateKey } from "./date";
import type { PrioritizableTask, PrioritizedList } from "./priority";

export type TimelineGroup = "today" | "needsEstimate" | "upcoming";

export interface TimelineBar {
  /** 帯の最初の列（0 = 今日）。範囲より前から始まるときは 0 に切り詰める */
  start: number;
  /** 帯の最後の列（その列を含む） */
  end: number;
  /** 着手すべき日が今日より前（＝遅れている） */
  clippedStart: boolean;
  /** 帯が範囲の後ろまで続く */
  clippedEnd: boolean;
}

export interface TimelineRow<T> {
  task: T;
  group: TimelineGroup;
  /** 範囲内に作業期間がなければ null（締切が今日以前・見積もり待ち・範囲より後など） */
  bar: TimelineBar | null;
  /** ◆を置く列。締切が範囲外（過ぎた・先すぎる）なら null */
  deadlineCol: number | null;
  deadlineDate: DateKey;
  /** 着手すべき日。見積もり待ちは null */
  startBy: DateKey | null;
  /** 帯も◆も範囲より後（着手すべき日、見積もり待ちなら締切が範囲の外） */
  afterRange: boolean;
}

export interface Timeline<T> {
  /** 横軸の日付（days 個） */
  days: DateKey[];
  rows: TimelineRow<T>[];
  /** 日ごとに、作業期間が重なっている締切の数 */
  load: number[];
}

export function buildTimeline<T extends PrioritizableTask>(
  list: PrioritizedList<T>,
  today: DateKey,
  dayCount: number,
): Timeline<T> {
  if (!Number.isInteger(dayCount) || dayCount <= 0) {
    throw new RangeError(`日数は正の整数で指定してください: ${dayCount}`);
  }
  const last = dayCount - 1;
  const col = (key: DateKey) => diffDays(today, key);
  const inRange = (c: number) => c >= 0 && c <= last;

  const days = Array.from({ length: dayCount }, (_, i) => addDays(today, i));
  const load = new Array<number>(dayCount).fill(0);

  const workRow = (item: PrioritizedList<T>["today"][number], group: TimelineGroup): TimelineRow<T> => {
    const startCol = col(item.startBy);
    const deadlineCol = col(item.deadlineDate);
    const endCol = deadlineCol - 1; // 締切日の前日まで
    let bar: TimelineBar | null = null;
    if (endCol >= 0 && startCol <= last) {
      bar = {
        start: Math.max(0, startCol),
        end: Math.min(last, endCol),
        clippedStart: startCol < 0,
        clippedEnd: endCol > last,
      };
      for (let c = bar.start; c <= bar.end; c++) load[c]++;
    }
    return {
      task: item.task,
      group,
      bar,
      deadlineCol: inRange(deadlineCol) ? deadlineCol : null,
      deadlineDate: item.deadlineDate,
      startBy: item.startBy,
      afterRange: startCol > last,
    };
  };

  const rows: TimelineRow<T>[] = [
    ...list.today.map((item) => workRow(item, "today")),
    ...list.needsEstimate.map((task): TimelineRow<T> => {
      // 見積もり待ちの締切日は prioritize が計算していないので、ここで日本時間の暦日に直す
      const deadlineDate = toDateKey(task.deadline);
      const deadlineCol = col(deadlineDate);
      return {
        task,
        group: "needsEstimate",
        bar: null,
        deadlineCol: inRange(deadlineCol) ? deadlineCol : null,
        deadlineDate,
        startBy: null,
        afterRange: deadlineCol > last,
      };
    }),
    ...list.upcoming.map((item) => workRow(item, "upcoming")),
  ];

  return { days, rows, load };
}
