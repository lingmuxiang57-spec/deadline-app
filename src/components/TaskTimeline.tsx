import Link from "next/link";
import { connection } from "next/server";
import type { CSSProperties } from "react";
import { getDb } from "@/db/client";
import { type TaskWithSource, getTaskBoard } from "@/db/queries";
import { syncStaleSources } from "@/db/syncSources";
import { type DateKey, parseDateKey, toDateKey } from "@/lib/date";
import { formatDateLabel, formatDeadline, formatEstimate, splitCourseSuffix } from "@/lib/format";
import { prioritize } from "@/lib/priority";
import { type TimelineRow, buildTimeline } from "@/lib/timeline";
import { type Urgency, urgencyOf } from "@/lib/urgency";

export const TIMELINE_WEEKS = [2, 4, 8] as const;
export type TimelineWeeks = (typeof TIMELINE_WEEKS)[number];
export const DEFAULT_TIMELINE_WEEKS: TimelineWeeks = 4;

/** URL の ?weeks= を表示週数にする。選択肢にない値は既定の4週 */
export function parseWeeks(value: string | string[] | undefined): TimelineWeeks {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (TIMELINE_WEEKS as readonly number[]).includes(n) ? (n as TimelineWeeks) : DEFAULT_TIMELINE_WEEKS;
}

const LABEL_WIDTH = "minmax(9rem, 15rem)";
const MIN_DAY_WIDTH = "1.75rem";

const BAR_COLOR: Record<Urgency, string> = {
  overdue: "bg-red-500/85",
  dueSoon: "bg-orange-400/90",
  behind: "bg-amber-400/90",
  normal: "bg-blue-500/80",
};

const DIAMOND_COLOR: Record<Urgency, string> = {
  overdue: "text-red-600 dark:text-red-400",
  dueSoon: "text-orange-600 dark:text-orange-400",
  behind: "text-amber-600 dark:text-amber-400",
  normal: "text-blue-700 dark:text-blue-300",
};

/**
 * 着手すべき日のタイムライン。1行が1つの締切で、
 * 帯 = 着手すべき日〜締切の前日（作業する期間）、◆ = 締切日。
 * 上の段には、日ごとに作業期間が重なっている締切の数を出す（作業が詰まる時期が分かる）。
 */
export async function TaskTimeline({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const weeks = parseWeeks((await searchParams).weeks);
  // better-sqlite3 は同期ドライバなので、事前レンダリングで読まれないよう先にリクエストを待つ
  await connection();
  const db = getDb();
  await syncStaleSources(db);

  const now = new Date();
  const today = toDateKey(now);
  const board = getTaskBoard(db, now);
  const timeline = buildTimeline(prioritize(board.open, now), today, weeks * 7);
  const dayCount = timeline.days.length;

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `${LABEL_WIDTH} repeat(${dayCount}, minmax(${MIN_DAY_WIDTH}, 1fr))`,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangeSwitch current={weeks} />
        <Legend />
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div style={{ minWidth: `calc(9rem + ${dayCount} * ${MIN_DAY_WIDTH})` }}>
          {/* 日付の見出し */}
          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={gridStyle}>
            <div className="sticky left-0 z-20 bg-white px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900">日付</div>
            {timeline.days.map((day, i) => (
              <DayHeader key={day} day={day} isToday={i === 0} isFirst={i === 0} />
            ))}
          </div>

          {/* 日ごとの重なり */}
          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={gridStyle}>
            <div className="sticky left-0 z-20 bg-white px-3 py-1.5 text-xs text-zinc-500 dark:bg-zinc-900">
              同時に進める数
            </div>
            {timeline.load.map((count, i) => (
              <div
                key={timeline.days[i]}
                className={`flex items-center justify-center py-1.5 text-xs font-medium ${loadColor(count)}`}
                title={`${formatDateLabel(timeline.days[i])}: ${count}件`}
              >
                {count > 0 ? count : ""}
              </div>
            ))}
          </div>

          {timeline.rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">この期間に表示する締切はありません</p>
          ) : (
            timeline.rows.map((row) => (
              <TimelineRowView
                key={row.task.id}
                row={row}
                days={timeline.days}
                gridStyle={gridStyle}
                now={now}
              />
            ))
          )}
        </div>
      </div>

      {timeline.laterCount > 0 && (
        <p className="text-sm text-zinc-500">
          この後に始まる締切が {timeline.laterCount}件あります。
          {weeks !== 8 && (
            <>
              {" "}
              <Link href={`/calendar?weeks=${weeks === 2 ? 4 : 8}`} className="text-blue-700 hover:underline dark:text-blue-300">
                表示する期間を広げる
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function TimelineRowView({
  row,
  days,
  gridStyle,
  now,
}: {
  row: TimelineRow<TaskWithSource>;
  days: DateKey[];
  gridStyle: CSSProperties;
  now: Date;
}) {
  const { task, bar, deadlineCol, startBy } = row;
  const urgency = urgencyOf({ deadline: task.deadline, now, startBy: startBy ?? undefined });
  const { title, course } = task.sourceId !== null ? splitCourseSuffix(task.title) : { title: task.title, course: null };
  const overdue = task.deadline < now;

  const summary = [
    title,
    course,
    startBy ? `着手 ${formatDateLabel(startBy)}` : "所要時間が未入力",
    `締切 ${formatDeadline(task.deadline)}`,
    task.estimateMinutes ? `所要 ${formatEstimate(task.estimateMinutes)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="group grid border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" style={gridStyle} title={summary}>
      {/* 行の見出し（横に動かしても左に残す） */}
      <div className="sticky left-0 z-20 flex min-w-0 flex-col justify-center bg-white px-3 py-2 group-hover:bg-zinc-50 dark:bg-zinc-900 dark:group-hover:bg-zinc-800" style={{ gridRow: 1, gridColumn: 1 }}>
        <span className="truncate text-sm font-medium">{title}</span>
        <span className={`truncate text-xs ${overdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
          {overdue
            ? "締切超過"
            : row.kind === "deadlineOnly"
              ? `見積もり待ち・締切 ${formatDateLabel(row.deadlineDate)}`
              : `${formatDateLabel(startBy!)}から着手`}
        </span>
      </div>

      {/* 背景（週末・今日） */}
      {days.map((day, i) => (
        <div key={day} aria-hidden className={dayBackground(day, i === 0)} style={{ gridRow: 1, gridColumn: i + 2 }} />
      ))}

      {/* 帯: 着手すべき日〜締切の前日 */}
      {bar && (
        <div
          className={`z-10 my-2.5 flex items-center text-[10px] font-bold text-white ${BAR_COLOR[urgency]} ${
            bar.clippedStart ? "rounded-r-md pl-1" : "ml-0.5 rounded-md"
          } ${bar.clippedEnd ? "justify-end rounded-r-none pr-1" : "mr-0.5"}`}
          style={{ gridRow: 1, gridColumn: `${bar.start + 2} / ${bar.end + 3}` }}
        >
          {bar.clippedStart && <span aria-label="着手が遅れている">←</span>}
          {bar.clippedEnd && <span aria-label="範囲の後ろまで続く">→</span>}
        </div>
      )}

      {/* ◆: 締切日 */}
      {deadlineCol !== null && (
        <div
          className={`z-10 flex items-center justify-center text-base leading-none ${
            row.kind === "deadlineOnly" ? "text-zinc-400" : DIAMOND_COLOR[urgency]
          }`}
          style={{ gridRow: 1, gridColumn: deadlineCol + 2 }}
          aria-label={`締切 ${formatDateLabel(row.deadlineDate)}`}
        >
          ◆
        </div>
      )}
    </div>
  );
}

function DayHeader({ day, isToday, isFirst }: { day: DateKey; isToday: boolean; isFirst: boolean }) {
  const { month, day: date } = parseDateKey(day);
  const weekday = weekdayOf(day);
  const showMonth = isFirst || date === 1;
  const weekdayColor = weekday === 0 ? "text-red-600 dark:text-red-400" : weekday === 6 ? "text-blue-600 dark:text-blue-400" : "text-zinc-500";
  return (
    <div className={`flex flex-col items-center py-1.5 text-xs leading-tight ${isToday ? "bg-blue-50 dark:bg-blue-950/50" : ""}`}>
      <span className={`font-medium ${isToday ? "text-blue-700 dark:text-blue-300" : ""}`}>
        {showMonth ? `${month}/${date}` : date}
      </span>
      <span className={weekdayColor}>{isToday ? "今日" : "日月火水木金土"[weekday]}</span>
    </div>
  );
}

function RangeSwitch({ current }: { current: TimelineWeeks }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">表示する期間</span>
      <div className="flex gap-1 rounded-lg bg-zinc-200/60 p-1 dark:bg-zinc-800/60">
        {TIMELINE_WEEKS.map((weeks) => (
          <Link
            key={weeks}
            href={weeks === DEFAULT_TIMELINE_WEEKS ? "/calendar" : `/calendar?weeks=${weeks}`}
            aria-current={weeks === current ? "true" : undefined}
            className={
              weeks === current
                ? "rounded-md bg-white px-2.5 py-0.5 font-medium shadow-sm dark:bg-zinc-900"
                : "rounded-md px-2.5 py-0.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }
          >
            {weeks}週間
          </Link>
        ))}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
      <li className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-6 rounded-sm bg-blue-500/80" />
        作業する期間（着手すべき日〜締切の前日）
      </li>
      <li className="flex items-center gap-1.5">
        <span className="text-blue-700 dark:text-blue-300">◆</span>締切
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-flex h-2.5 w-6 items-center rounded-r-sm bg-amber-400/90 pl-0.5 text-[8px] font-bold text-white">←</span>
        着手が遅れている
      </li>
      <li className="flex items-center gap-1.5">
        <span className="text-zinc-400">◆</span>見積もり待ち
      </li>
    </ul>
  );
}

function weekdayOf(day: DateKey): number {
  const { year, month, day: date } = parseDateKey(day);
  return new Date(Date.UTC(year, month - 1, date)).getUTCDay();
}

function dayBackground(day: DateKey, isToday: boolean): string {
  if (isToday) return "bg-blue-50 dark:bg-blue-950/40";
  const weekday = weekdayOf(day);
  return weekday === 0 || weekday === 6 ? "bg-zinc-50 dark:bg-zinc-800/40" : "";
}

/** 重なりの数を色の濃さで表す。3件以上は「詰まっている」 */
function loadColor(count: number): string {
  if (count === 0) return "text-zinc-300";
  if (count === 1) return "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
  if (count === 2) return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
  return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
}
