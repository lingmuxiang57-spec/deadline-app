/**
 * 1行入力（例:「ゼミ発表資料 12/5」）を件名と締切に分ける。
 * Slack・LINE・メールで届いた締切を、打ったそのままの書き方で入れられるようにする。
 *
 * 受け付ける日付（行の末尾か先頭に置く）:
 *   12/5, 2026/12/5, 12月5日, 2026年12月5日, 今日, 明日, 明後日
 *   曜日の添え書き「12/5(金)」は読み飛ばす
 * 受け付ける時刻（日付の直後）:
 *   9:00, 9時, 9時半, 9時30分, 24:00（その日の 23:59 として扱う）
 *   時刻がなければその日の 23:59
 * 年を省いた日付は、今日から最も近い年にする（12/20 に「1/10」→ 翌年、1/3 に「12/28」→ 前年）
 * 全角の数字・記号・空白も受け付ける
 */
import {
  type DateKey,
  END_OF_DAY,
  addDays,
  diffDays,
  formatDateKey,
  isValidDate,
  jstDateTime,
  toWallTime,
} from "./date";

export type QuickAddError = "empty" | "noDate" | "invalidDate" | "invalidTime" | "noTitle";

export type QuickAddResult =
  | {
      ok: true;
      title: string;
      deadline: Date;
      /** 締切日（日本時間） */
      deadlineDate: DateKey;
      /** 時刻が書かれていたか（false なら 23:59 を補っている） */
      hasTime: boolean;
    }
  | { ok: false; error: QuickAddError };

export const QUICK_ADD_ERROR_MESSAGES: Record<QuickAddError, string> = {
  empty: "入力が空です",
  noDate: "締切の日付が見つかりません（例: ゼミ発表資料 12/5）",
  invalidDate: "存在しない日付です",
  invalidTime: "時刻が正しくありません",
  noTitle: "件名がありません",
};

const RELATIVE_DAYS: Record<string, number> = {
  今日: 0,
  きょう: 0,
  明日: 1,
  あした: 1,
  明後日: 2,
  あさって: 2,
};

const DATE_PATTERN =
  "(?:(?:(?<year>\\d{4})[/年])?(?<month>\\d{1,2})(?:/|月)(?<day>\\d{1,2})日?" +
  `|(?<relative>${Object.keys(RELATIVE_DAYS).join("|")}))`;
const WEEKDAY_PATTERN = "(?:\\s*\\([月火水木金土日](?:曜日?)?\\))?";
const TIME_PATTERN =
  "(?:\\s*(?<hour>\\d{1,2})(?::(?<minute>\\d{2})|時(?:(?<half>半)|(?<jpMinute>\\d{1,2})分)?))?";
const DATE_TIME = DATE_PATTERN + WEEKDAY_PATTERN + TIME_PATTERN;

/** 行末の日付。直前が数字や「/」のとき（例:「第112/5」）は日付の一部とみなさない */
const TRAILING = new RegExp(`(?<![\\d/])${DATE_TIME}\\s*$`);
/** 行頭の日付。後ろに件名が続く */
const LEADING = new RegExp(`^${DATE_TIME}(?=\\s|$)`);

/** 件名の前後に残りがちな区切り記号（長音「ー」は「コピー」などを壊すので含めない） */
const TITLE_TRIM = /^[\s,、。:\-〜~]+|[\s,、。:\-〜~]+$/g;

export function parseQuickAdd(input: string, now: Date): QuickAddResult {
  const text = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (text === "") {
    return { ok: false, error: "empty" };
  }

  const match = TRAILING.exec(text) ?? LEADING.exec(text);
  if (!match?.groups) {
    return { ok: false, error: "noDate" };
  }
  const g = match.groups;

  const deadlineDate = resolveDate(g, toWallTime(now));
  if (deadlineDate === null) {
    return { ok: false, error: "invalidDate" };
  }

  const time = resolveTime(g);
  if (time === "invalid") {
    return { ok: false, error: "invalidTime" };
  }

  const title = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
    .replace(/\s+/g, " ")
    .replace(TITLE_TRIM, "");
  if (title === "") {
    return { ok: false, error: "noTitle" };
  }

  return {
    ok: true,
    title,
    deadline: jstDateTime(deadlineDate, time ?? END_OF_DAY),
    deadlineDate,
    hasTime: time !== null,
  };
}

type Groups = Record<string, string | undefined>;

function resolveDate(g: Groups, today: { year: number; month: number; day: number }): DateKey | null {
  const todayKey = formatDateKey(today.year, today.month, today.day);

  if (g.relative !== undefined) {
    return addDays(todayKey, RELATIVE_DAYS[g.relative]);
  }

  const month = Number(g.month);
  const day = Number(g.day);

  if (g.year !== undefined) {
    const year = Number(g.year);
    return isValidDate(year, month, day) ? formatDateKey(year, month, day) : null;
  }

  // 年がなければ、前年・今年・翌年のうち今日に最も近い日付を選ぶ
  let best: DateKey | null = null;
  for (const year of [today.year - 1, today.year, today.year + 1]) {
    if (!isValidDate(year, month, day)) continue;
    const key = formatDateKey(year, month, day);
    if (best === null || Math.abs(diffDays(todayKey, key)) < Math.abs(diffDays(todayKey, best))) {
      best = key;
    }
  }
  return best;
}

function resolveTime(g: Groups): { hour: number; minute: number } | null | "invalid" {
  if (g.hour === undefined) {
    return null;
  }
  const hour = Number(g.hour);
  const minute = g.half !== undefined ? 30 : Number(g.minute ?? g.jpMinute ?? 0);

  // 「24:00締切」はその日のうちに出すという意味なので、日付を変えずに 23:59 とする
  if (hour === 24 && minute === 0) {
    return { ...END_OF_DAY };
  }
  if (hour > 23 || minute > 59) {
    return "invalid";
  }
  return { hour, minute };
}
