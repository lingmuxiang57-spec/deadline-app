/**
 * 締切の急ぎ具合。画面の色分けとバッジに使う。
 *
 *   overdue … 締切を過ぎた
 *   dueSoon … 締切が今日か明日
 *   behind  … 着手すべき日を過ぎた（締切はまだ先）
 *   normal  … それ以外
 */
import { type DateKey, addDays, diffDays, toDateKey } from "./date";

export type Urgency = "overdue" | "dueSoon" | "behind" | "normal";

export function urgencyOf(params: { deadline: Date; now: Date; startBy?: DateKey }): Urgency {
  const { deadline, now, startBy } = params;
  if (deadline < now) return "overdue";
  const today = toDateKey(now);
  if (toDateKey(deadline) <= addDays(today, 1)) return "dueSoon";
  if (startBy !== undefined && startBy < today) return "behind";
  return "normal";
}

/** 行の右に出すバッジの文言。例: "締切超過", "今日まで", "明日まで", "あと5日" */
export function dueBadgeLabel(deadline: Date, now: Date): string {
  if (deadline < now) return "締切超過";
  const days = diffDays(toDateKey(now), toDateKey(deadline));
  if (days === 0) return "今日まで";
  if (days === 1) return "明日まで";
  return `あと${days}日`;
}

/** 着手すべき日からどれだけ遅れているか（日数）。遅れていなければ 0 */
export function daysBehind(startBy: DateKey, today: DateKey): number {
  return Math.max(0, diffDays(startBy, today));
}
