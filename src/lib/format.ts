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

/** 日時の表示。例: "11/23(月) 9:05" */
export function formatDateTime(date: Date): string {
  const { hour, minute } = toWallTime(date);
  return `${formatDateLabel(toDateKey(date))} ${hour}:${String(minute).padStart(2, "0")}`;
}

/**
 * iCal URLの表示用。URL自体が認証トークンなので、ホスト名だけ見せて残りは伏せる。
 * 例: "https://lms.example.jp/feeds/calendars/user_abc.ics" → "https://lms.example.jp/…"
 */
export function maskFeedUrl(url: string): string {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "（URL）";
  }
}

/**
 * K-LMS（Canvas）の件名は「課題名 [授業名]」の形で届き、授業名の中にも「[火2]」のような括弧が入る。
 * 末尾の対応する [ … ] を授業名として切り離す。括弧の対応が取れなければ、そのまま件名として返す。
 *   "課題レポート７ [[火2]杉浦 壽彦　機械系の動力学]" → { title: "課題レポート７", course: "[火2]杉浦 壽彦　機械系の動力学" }
 */
export function splitCourseSuffix(fullTitle: string): { title: string; course: string | null } {
  const trimmed = fullTitle.trim();
  if (!trimmed.endsWith("]")) return { title: trimmed, course: null };

  let depth = 0;
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i] === "]") depth++;
    else if (trimmed[i] === "[") depth--;
    if (depth === 0) {
      const title = trimmed.slice(0, i).trim();
      const course = trimmed.slice(i + 1, -1).trim();
      // 件名がすべて括弧（例: "[重要]"）なら切り離さない
      return title === "" || course === "" ? { title: trimmed, course: null } : { title, course };
    }
  }
  return { title: trimmed, course: null };
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
