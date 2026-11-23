/**
 * 画面表示用の書式（日本時間）。
 */
import { type DateKey, END_OF_DAY, diffDays, parseDateKey, toDateKey, toWallTime } from "./date";
import { ESTIMATE_OPTIONS } from "./priority";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** "2026-12-05" → "12/5(土)" */
export function formatDateLabel(key: DateKey): string {
  const { year, month, day } = parseDateKey(key);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day}(${weekday})`;
}

/** 締切の表示。23:59 は「その日中」なので時刻を省く。例: "12/5(土) 9:00", "12/5(土)" */
export function formatDeadline(deadline: Date): string {
  const label = formatDateLabel(toDateKey(deadline));
  const { hour, minute } = toWallTime(deadline);
  if (hour === END_OF_DAY.hour && minute === END_OF_DAY.minute) {
    return label;
  }
  return `${label} ${hour}:${String(minute).padStart(2, "0")}`;
}

/** 今日から見た日付の近さ。例: "今日", "明日", "あと5日", "昨日", "3日前" */
export function formatRelativeDay(today: DateKey, target: DateKey): string {
  const days = diffDays(today, target);
  if (days === 0) return "今日";
  if (days === 1) return "明日";
  if (days === 2) return "あさって";
  if (days === -1) return "昨日";
  return days > 0 ? `あと${days}日` : `${-days}日前`;
}

/** 所要時間（分）の表示。選択肢にあればそのラベル、なければ時間・分で表す */
export function formatEstimate(minutes: number): string {
  const option = ESTIMATE_OPTIONS.find((o) => o.minutes === minutes);
  if (option) return option.label;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
