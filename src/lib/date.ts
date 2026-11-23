/**
 * 日付・タイムゾーンの共通処理。
 * 「今日」「締切日」はすべて日本時間で判定する（iCalの日時はUTCで届くことが多い）。
 */

/** 「今日」「締切日」を判定するタイムゾーン */
export const TIME_ZONE = "Asia/Tokyo";

/** 時刻のない締切（「12/5」や終日の予定）は、その日の 23:59（日本時間）を締切とみなす */
export const END_OF_DAY = { hour: 23, minute: 59 } as const;

/** 日本時間の暦日を "YYYY-MM-DD" で表したもの。文字列のまま大小比較できる */
export type DateKey = string;

export interface WallTime {
  year: number;
  /** 1〜12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function assertValidDate(date: Date, name: string): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`${name} が不正な日時です`);
  }
}

/** 日時が指定タイムゾーンで何年何月何日何時何分かを返す */
export function toWallTime(date: Date, timeZone: string = TIME_ZONE): Required<WallTime> {
  assertValidDate(date, "date");
  const parts = getFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** 日時を指定タイムゾーン（既定は日本時間）の暦日に直す */
export function toDateKey(date: Date, timeZone: string = TIME_ZONE): DateKey {
  const { year, month, day } = toWallTime(date, timeZone);
  return formatDateKey(year, month, day);
}

export function formatDateKey(year: number, month: number, day: number): DateKey {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(key: DateKey): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) {
    throw new RangeError(`日付の形式が不正です: ${key}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 暦日として存在するか（2/30 や 13/1 を弾く） */
export function isValidDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 暦日に日数を足す（負なら引く）。月・年またぎも扱う */
export function addDays(key: DateKey, days: number): DateKey {
  const { year, month, day } = parseDateKey(key);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** 2つの暦日の差（b − a）を日数で返す */
export function diffDays(a: DateKey, b: DateKey): number {
  const toUtc = (key: DateKey) => {
    const { year, month, day } = parseDateKey(key);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** IANA のタイムゾーン名として使えるか */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** 指定タイムゾーンの壁時計の時刻（例: 東京の 12/5 9:00）を Date にする */
export function zonedTimeToDate(wall: WallTime, timeZone: string = TIME_ZONE): Date {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0,
  );
  // その時点でのUTCとの差を求めて引く。夏時間の境目に備えて、差が変わったら一度だけ取り直す
  const offsetAt = (ms: number) => {
    const w = toWallTime(new Date(ms), timeZone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
  };
  const firstOffset = offsetAt(asUtc);
  const secondOffset = offsetAt(asUtc - firstOffset);
  return new Date(asUtc - secondOffset);
}

/** 暦日と時刻（日本時間）から Date を作る。時刻を省くとその日の 23:59 */
export function jstDateTime(
  key: DateKey,
  time: { hour: number; minute: number } = END_OF_DAY,
): Date {
  return zonedTimeToDate({ ...parseDateKey(key), ...time }, TIME_ZONE);
}
