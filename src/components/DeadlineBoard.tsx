import Link from "next/link";
import { connection } from "next/server";
import type { CSSProperties, ReactNode } from "react";
import { deleteTask, keepTask, reopenTask, restoreTask, syncNow } from "@/app/actions";
import { getDb } from "@/db/client";
import { type TaskWithSource, getSources, getTaskBoard } from "@/db/queries";
import { syncStaleSources } from "@/db/syncSources";
import { type DateKey, parseDateKey, toDateKey } from "@/lib/date";
import { formatDateLabel, formatDeadline, formatEstimate, splitCourseSuffix } from "@/lib/format";
import { prioritize } from "@/lib/priority";
import { type Timeline, type TimelineGroup, type TimelineRow, buildTimeline } from "@/lib/timeline";
import { type Urgency, urgencyOf } from "@/lib/urgency";
import { PendingButton } from "./PendingButton";
import { CompleteButton, TaskButton, TaskMenu } from "./TaskControls";

export const TIMELINE_WEEKS = [2, 4, 8] as const;
export type TimelineWeeks = (typeof TIMELINE_WEEKS)[number];
export const DEFAULT_TIMELINE_WEEKS: TimelineWeeks = 4;

/** URL の ?weeks= を表示週数にする。選択肢にない値は既定の4週 */
export function parseWeeks(value: string | string[] | undefined): TimelineWeeks {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (TIMELINE_WEEKS as readonly number[]).includes(n) ? (n as TimelineWeeks) : DEFAULT_TIMELINE_WEEKS;
}

const LABEL_WIDTH = "minmax(13rem, 19rem)";
const LABEL_MIN = "13rem";
const MIN_DAY_WIDTH = "1.75rem";

const GROUPS: { key: TimelineGroup; title: string; note?: string; empty?: string }[] = [
  { key: "today", title: "今日やる", empty: "今日着手すべき締切はありません" },
  { key: "needsEstimate", title: "見積もりを入れて", note: "所要時間を選ぶと、着手すべき日が決まって帯が出ます" },
  { key: "upcoming", title: "これから" },
];

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
 * 締切の一覧と操作をまとめた画面（トップページ）。
 * 開いたときにフィードを同期し、着手すべき日をタイムラインで示しながら、
 * 行の見出しで完了・所要時間の設定・削除ができる。
 *
 *   帯 = 着手すべき日〜締切の前日（作業する期間）、◆ = 締切日
 *   上の段 = 日ごとに作業期間が重なっている締切の数（作業が詰まる時期が分かる）
 */
export async function DeadlineBoard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const weeks = parseWeeks((await searchParams).weeks);
  // better-sqlite3 は同期ドライバなので、事前レンダリングで読まれないよう先にリクエストを待つ
  await connection();
  const db = getDb();
  await syncStaleSources(db);

  const now = new Date();
  const today = toDateKey(now);
  const board = getTaskBoard(db, now);
  const list = prioritize(board.open, now);
  const timeline = buildTimeline(list, today, weeks * 7);
  const sources = getSources(db);
  const failedSources = sources.filter((s) => s.lastSyncError);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <p>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatDateLabel(today)}</span>
          {" ・ "}今日やる {list.today.length}件
          {list.needsEstimate.length > 0 && ` ・ 見積もり待ち ${list.needsEstimate.length}件`}
        </p>
        {sources.length > 0 && (
          <form action={syncNow}>
            <PendingButton type="submit" className="rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              今すぐ同期
            </PendingButton>
          </form>
        )}
      </div>

      {sources.length === 0 && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          K-LMS や Google カレンダーを登録すると、締切を自動で取り込めます。{" "}
          <Link href="/sources" className="font-medium underline">
            フィードを登録する
          </Link>
        </p>
      )}

      {failedSources.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        >
          {failedSources.map((s) => (
            <p key={s.id}>
              {s.name} の同期に失敗しました：{s.lastSyncError}
            </p>
          ))}
        </div>
      )}

      {board.cancelPending.length > 0 && (
        <CompactSection title="取り消された？" note="フィードから消えた締切です。削除するか残すかを選んでください" tone="warning">
          {board.cancelPending.map((task) => (
            <CompactRow
              key={task.id}
              task={task}
              actions={
                <>
                  <TaskButton action={deleteTask} id={task.id} variant="danger">
                    削除
                  </TaskButton>
                  <TaskButton action={keepTask} id={task.id}>
                    残す
                  </TaskButton>
                </>
              }
            />
          ))}
        </CompactSection>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <RangeSwitch current={weeks} />
          <Legend />
        </div>
        <TimelineTable timeline={timeline} now={now} />
      </div>

      {board.doneToday.length > 0 && (
        <CompactSection title="今日完了">
          {board.doneToday.map((task) => (
            <CompactRow
              key={task.id}
              task={task}
              muted
              actions={
                <TaskButton action={reopenTask} id={task.id}>
                  戻す
                </TaskButton>
              }
            />
          ))}
        </CompactSection>
      )}

      {board.dismissed.length > 0 && (
        <details className="group text-sm">
          <summary className="cursor-pointer list-none text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> 削除したもの（
            {board.dismissed.length}件）
          </summary>
          <p className="mt-2 text-zinc-500">フィードから取り込んだ締切で、自分で削除したものです。同期しても戻りません。</p>
          <div className="mt-2">
            <CompactList>
              {board.dismissed.map((task) => (
                <CompactRow
                  key={task.id}
                  task={task}
                  muted
                  actions={
                    <TaskButton action={restoreTask} id={task.id}>
                      戻す
                    </TaskButton>
                  }
                />
              ))}
            </CompactList>
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// タイムライン

function TimelineTable({ timeline, now }: { timeline: Timeline<TaskWithSource>; now: Date }) {
  const dayCount = timeline.days.length;
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `${LABEL_WIDTH} repeat(${dayCount}, minmax(${MIN_DAY_WIDTH}, 1fr))`,
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div style={{ minWidth: `calc(${LABEL_MIN} + ${dayCount} * ${MIN_DAY_WIDTH})` }}>
        {/* 日付の見出し */}
        <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={gridStyle}>
          <div className="sticky left-0 z-20 bg-white px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900">締切</div>
          {timeline.days.map((day, i) => (
            <DayHeader key={day} day={day} isToday={i === 0} />
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

        {GROUPS.map((group) => {
          const rows = timeline.rows.filter((row) => row.group === group.key);
          if (rows.length === 0 && !group.empty) return null;
          return (
            <section key={group.key} aria-label={group.title}>
              <div className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50">
                <div className="sticky left-0 inline-flex items-baseline gap-2 px-3 py-1.5">
                  <h2 className={`font-semibold ${group.key === "today" ? "text-sm" : "text-xs"}`}>{group.title}</h2>
                  <span className="text-xs text-zinc-500">{rows.length}件</span>
                  {group.note && rows.length > 0 && <span className="hidden text-xs text-zinc-500 sm:inline">{group.note}</span>}
                </div>
              </div>
              {rows.length === 0 ? (
                <p className="sticky left-0 inline-block px-3 py-3 text-sm text-zinc-500">{group.empty}</p>
              ) : (
                rows.map((row) => (
                  <TimelineRowView key={row.task.id} row={row} days={timeline.days} gridStyle={gridStyle} now={now} />
                ))
              )}
            </section>
          );
        })}
      </div>
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
  const { title, course } = titleParts(task);
  const overdue = task.deadline < now;
  const dayCount = days.length;

  const subline = overdue
    ? `締切超過（${formatDeadline(task.deadline)}）`
    : row.group === "upcoming"
      ? `${formatDateLabel(startBy!)}から着手・${formatDeadline(task.deadline)}締切`
      : `${formatDeadline(task.deadline)}締切`;
  // 自分で締切を変えたフィード由来の締切には印を付ける（元の締切はメニューと吹き出しに出す）
  const changedMark = task.feedDeadline ? "（変更）" : "";

  const tooltip = [
    title,
    course,
    startBy ? `着手 ${formatDateLabel(startBy)}` : "所要時間が未入力",
    `締切 ${formatDeadline(task.deadline)}`,
    task.feedDeadline ? `${task.sourceName ?? "フィード"}の締切 ${formatDeadline(task.feedDeadline)}` : null,
    task.estimateMinutes ? `所要 ${formatEstimate(task.estimateMinutes)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="group grid border-b border-zinc-100 last:border-b-0 dark:border-zinc-800" style={gridStyle}>
      {/* 行の見出し（横に動かしても左に残す）。完了・所要時間・削除はここで操作する */}
      <div
        className="sticky left-0 z-20 flex min-w-0 gap-2 border-r border-zinc-100 bg-white px-3 py-2 group-hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:group-hover:bg-zinc-800"
        style={{ gridRow: 1, gridColumn: 1 }}
      >
        <div className="pt-0.5">
          <CompleteButton id={task.id} label={title} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-medium" title={tooltip}>
            {title}
          </p>
          <p className={`truncate text-xs ${overdue ? "font-medium text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
            {subline}
            {changedMark}
            <span className="text-zinc-400">・{task.sourceName ?? "手入力"}</span>
          </p>
          <TaskMenu task={task} label={title} />
        </div>
      </div>

      {/* 背景（週末・今日） */}
      {days.map((day, i) => (
        <div key={day} aria-hidden className={dayBackground(day, i === 0)} style={{ gridRow: 1, gridColumn: i + 2 }} />
      ))}

      {/* 帯: 着手すべき日〜締切の前日 */}
      {bar && (
        <div
          className={`z-10 mt-3 flex h-5 items-center self-start text-[10px] font-bold text-white ${BAR_COLOR[urgency]} ${
            bar.clippedStart ? "rounded-r-md pl-1" : "ml-0.5 rounded-md"
          } ${bar.clippedEnd ? "justify-end rounded-r-none pr-1" : "mr-0.5"}`}
          style={{ gridRow: 1, gridColumn: `${bar.start + 2} / ${bar.end + 3}` }}
          title={tooltip}
        >
          {bar.clippedStart && <span aria-label="着手が遅れている">←</span>}
          {bar.clippedEnd && <span aria-label="表示する期間の後ろまで続く">→</span>}
        </div>
      )}

      {/* ◆: 締切日 */}
      {deadlineCol !== null && (
        <div
          className={`z-10 mt-2.5 flex h-6 items-center justify-center self-start text-base leading-none ${
            row.group === "needsEstimate" ? "text-zinc-400" : DIAMOND_COLOR[urgency]
          }`}
          style={{ gridRow: 1, gridColumn: deadlineCol + 2 }}
          aria-label={`締切 ${formatDateLabel(row.deadlineDate)}`}
          title={tooltip}
        >
          ◆
        </div>
      )}

      {/* 範囲より後のものは、右端に「いつから」を出す */}
      {row.afterRange && (
        <div
          className="z-10 mt-3 flex h-5 items-center justify-end self-start pr-2 text-xs whitespace-nowrap text-zinc-500"
          style={{ gridRow: 1, gridColumn: `${Math.max(2, dayCount - 3)} / ${dayCount + 2}` }}
        >
          {startBy ? `${formatDateLabel(startBy)}から` : `締切 ${formatDateLabel(row.deadlineDate)}`} →
        </div>
      )}
    </div>
  );
}

function DayHeader({ day, isToday }: { day: DateKey; isToday: boolean }) {
  const { month, day: date } = parseDateKey(day);
  const weekday = weekdayOf(day);
  const showMonth = isToday || date === 1;
  const weekdayColor =
    weekday === 0 ? "text-red-600 dark:text-red-400" : weekday === 6 ? "text-blue-600 dark:text-blue-400" : "text-zinc-500";
  return (
    <div className={`flex flex-col items-center py-1.5 text-xs leading-tight ${isToday ? "bg-blue-50 dark:bg-blue-950/50" : ""}`}>
      <span className={`font-medium ${isToday ? "text-blue-700 dark:text-blue-300" : ""}`}>
        {showMonth ? `${month}/${date}` : date}
      </span>
      <span className={isToday ? "font-medium text-blue-700 dark:text-blue-300" : weekdayColor}>
        {isToday ? "今日" : "日月火水木金土"[weekday]}
      </span>
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
            href={weeks === DEFAULT_TIMELINE_WEEKS ? "/" : `/?weeks=${weeks}`}
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
        <span className="inline-flex h-2.5 w-6 items-center rounded-r-sm bg-amber-400/90 pl-0.5 text-[8px] font-bold text-white">
          ←
        </span>
        着手が遅れている
      </li>
      <li className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-full bg-red-500/85" />
        締切超過
        <span className="ml-1 inline-block size-2.5 rounded-full bg-orange-400/90" />
        今日・明日が締切
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// タイムラインの外の小さな一覧（取り消し確認・今日完了・削除したもの）

function CompactSection({
  title,
  note,
  tone = "default",
  children,
}: {
  title: string;
  note?: string;
  tone?: "default" | "warning";
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className={`text-base font-semibold ${tone === "warning" ? "text-amber-800 dark:text-amber-300" : ""}`}>{title}</h2>
        {note && <p className="text-sm text-zinc-500">{note}</p>}
      </div>
      <CompactList>{children}</CompactList>
    </section>
  );
}

function CompactList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </ul>
  );
}

function CompactRow({ task, actions, muted = false }: { task: TaskWithSource; actions: ReactNode; muted?: boolean }) {
  const { title, course } = titleParts(task);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${muted ? "text-zinc-400 line-through" : ""}`} title={course ?? undefined}>
          {title}
        </p>
        <p className="truncate text-xs text-zinc-500">
          {formatDeadline(task.deadline)}締切・{task.sourceName ?? "手入力"}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">{actions}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------

/** フィード由来の件名は末尾の「[授業名]」を切り離す（手入力は打ったまま） */
function titleParts(task: TaskWithSource): { title: string; course: string | null } {
  return task.sourceId !== null ? splitCourseSuffix(task.title) : { title: task.title, course: null };
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
