/**
 * 締切を変える入力欄（日付 type="date" ＋ 時刻 type="time"）と日時のあいだの変換。
 * 時刻を空にしたら、手入力の「12/5」と同じくその日の 23:59（日本時間）とみなす。
 */
import { END_OF_DAY, type DateKey, isValidDate, jstDateTime, parseDateKey, toDateKey, toWallTime } from "./date";

/** 入力欄の値を日時にする。形式が正しくない・存在しない日付・時刻なら null */
export function parseDeadlineInput(date: unknown, time: unknown): Date | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { year, month, day } = parseDateKey(date);
  if (!isValidDate(year, month, day)) return null;

  const timeText = typeof time === "string" ? time.trim() : "";
  if (timeText === "") return jstDateTime(date as DateKey);

  const match = /^(\d{2}):(\d{2})$/.exec(timeText);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return jstDateTime(date as DateKey, { hour, minute });
}

/** 日時を入力欄の初期値にする。23:59 は「時刻なし」として時刻欄を空にする */
export function toDeadlineInputValues(deadline: Date): { date: string; time: string } {
  const { hour, minute } = toWallTime(deadline);
  const time =
    hour === END_OF_DAY.hour && minute === END_OF_DAY.minute
      ? ""
      : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { date: toDateKey(deadline), time };
}
