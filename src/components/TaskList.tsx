import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import {
  completeTask,
  deleteTask,
  dismissTask,
  keepTask,
  reopenTask,
  restoreTask,
  syncNow,
} from "@/app/actions";
import { getDb } from "@/db/client";
import { type TaskWithSource, getSources, getTaskBoard } from "@/db/queries";
import { syncStaleSources } from "@/db/syncSources";
import { type DateKey, toDateKey } from "@/lib/date";
import { formatDateLabel, formatDeadline, formatEstimate, splitCourseSuffix } from "@/lib/format";
import { type PrioritizedTask, prioritize } from "@/lib/priority";
import { type Urgency, daysBehind, dueBadgeLabel, urgencyOf } from "@/lib/urgency";
import { EstimatePicker } from "./EstimatePicker";
import { TWO_COLUMN_GRID } from "./layout";
import { PendingButton } from "./PendingButton";

/** 「見積もりを入れて」で最初から見せる件数。残りは折りたたむ */
const NEEDS_ESTIMATE_VISIBLE = 5;

/**
 * 今日やるべきリスト。開いたときにフィードを同期し、
 * 「取り消された？」「今日やる」「見積もりを入れて」「これから」「今日完了」に分けて出す。
 *
 * 見やすさのために:
 *   - 急ぎ具合（締切超過・今日明日が締切・着手の遅れ）を左端の色の帯と右のバッジで示す
 *   - 行の情報は欄ごとに必要なものだけにする（「これから」は着手日、「今日やる」は締切）
 *   - 所要時間の7択や削除は、押したときだけ開くメニューにしまう
 */
export async function TaskList() {
  // better-sqlite3 は同期ドライバなので、事前レンダリングで読まれないよう先にリクエストを待つ
  await connection();
  const db = getDb();
  await syncStaleSources(db);

  const now = new Date();
  const today = toDateKey(now);
  const board = getTaskBoard(db, now);
  const list = prioritize(board.open, now);
  const sources = getSources(db);
  const failedSources = sources.filter((s) => s.lastSyncError);

  const visibleNeedsEstimate = list.needsEstimate.slice(0, NEEDS_ESTIMATE_VISIBLE);
  const hiddenNeedsEstimate = list.needsEstimate.slice(NEEDS_ESTIMATE_VISIBLE);

  return (
    <div className="flex flex-col gap-8">
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
        <Section title="取り消された？" note="フィードから消えた締切です。削除するか残すかを選んでください">
          {board.cancelPending.map((task) => (
            <Row
              key={task.id}
              task={task}
              urgency="behind"
              meta={<DeadlineText deadline={task.deadline} />}
              trailing={
                <div className="flex gap-2">
                  <TaskButton action={deleteTask} id={task.id} variant="danger">
                    削除
                  </TaskButton>
                  <TaskButton action={keepTask} id={task.id}>
                    残す
                  </TaskButton>
                </div>
              }
            />
          ))}
        </Section>
      )}

      <div className={TWO_COLUMN_GRID}>
        {/* 左（メイン）: 何をいつやるか */}
        <div className="flex min-w-0 flex-col gap-8">
          <Section title="今日やる" count={list.today.length} emphasis empty="今日着手すべき締切はありません">
            {list.today.map((item) => (
              <TodayRow key={item.task.id} item={item} today={today} now={now} />
            ))}
          </Section>

          {list.upcoming.length > 0 && (
            <Section title="これから" count={list.upcoming.length}>
              {list.upcoming.map((item) => (
                <UpcomingRow key={item.task.id} item={item} now={now} />
              ))}
            </Section>
          )}
        </div>

        {/* 右（サイド）: 合間に片付けること */}
        <div className="flex min-w-0 flex-col gap-8">
          {list.needsEstimate.length > 0 && (
            <Section
              title="見積もりを入れて"
              count={list.needsEstimate.length}
              note="所要時間を選ぶと、着手すべき日が決まって「今日やる」「これから」に並びます"
              footer={
                hiddenNeedsEstimate.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer list-none px-1 py-2 text-sm text-blue-700 hover:underline dark:text-blue-300">
                      <span className="group-open:hidden">残り {hiddenNeedsEstimate.length}件を表示</span>
                      <span className="hidden group-open:inline">残りを閉じる</span>
                    </summary>
                    <RowList>
                      {hiddenNeedsEstimate.map((task) => (
                        <NeedsEstimateRow key={task.id} task={task} now={now} />
                      ))}
                    </RowList>
                  </details>
                )
              }
            >
              {visibleNeedsEstimate.map((task) => (
                <NeedsEstimateRow key={task.id} task={task} now={now} />
              ))}
            </Section>
          )}

          {board.doneToday.length > 0 && (
            <Section title="今日完了" count={board.doneToday.length}>
              {board.doneToday.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  muted
                  meta={<DeadlineText deadline={task.deadline} />}
                  trailing={
                    <TaskButton action={reopenTask} id={task.id}>
                      戻す
                    </TaskButton>
                  }
                />
              ))}
            </Section>
          )}

          {board.dismissed.length > 0 && (
            <details className="group text-sm">
              <summary className="cursor-pointer list-none text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                <span className="inline-block transition-transform group-open:rotate-90">›</span> 削除したもの（
                {board.dismissed.length}件）
              </summary>
              <p className="mt-2 text-zinc-500">フィードから取り込んだ締切で、自分で削除したものです。同期しても戻りません。</p>
              <div className="mt-2">
                <RowList>
                  {board.dismissed.map((task) => (
                    <Row
                      key={task.id}
                      task={task}
                      muted
                      meta={<DeadlineText deadline={task.deadline} />}
                      trailing={
                        <TaskButton action={restoreTask} id={task.id}>
                          戻す
                        </TaskButton>
                      }
                    />
                  ))}
                </RowList>
              </div>
            </details>
          )}

          {list.needsEstimate.length === 0 && board.doneToday.length === 0 && board.dismissed.length === 0 && (
            <p className="hidden rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 lg:block dark:border-zinc-700">
              見積もり待ちの締切はありません
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 欄

function Section({
  title,
  count,
  note,
  empty,
  emphasis = false,
  footer,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  empty?: string;
  emphasis?: boolean;
  footer?: ReactNode;
  children: ReactNode[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className={`flex items-center gap-2 font-semibold ${emphasis ? "text-xl" : "text-base"}`}>
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {count}
            </span>
          )}
        </h2>
        {note && <p className="text-sm text-zinc-500">{note}</p>}
      </div>
      {children.length > 0 ? (
        <RowList>{children}</RowList>
      ) : (
        empty && (
          <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {empty}
          </p>
        )
      )}
      {footer}
    </section>
  );
}

function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 欄ごとの行

/** 「今日やる」: 締切を主に見せ、着手が遅れていればそれも出す */
function TodayRow({ item, today, now }: { item: PrioritizedTask<TaskWithSource>; today: DateKey; now: Date }) {
  const { task, startBy } = item;
  const urgency = urgencyOf({ deadline: task.deadline, now, startBy });
  const behind = daysBehind(startBy, today);
  return (
    <Row
      task={task}
      urgency={urgency}
      leading={<CompleteButton id={task.id} />}
      badge={<DueBadge deadline={task.deadline} now={now} urgency={urgency} />}
      meta={
        <>
          <DeadlineText deadline={task.deadline} />
          {behind > 0 && urgency !== "overdue" && (
            <span className="font-medium text-amber-700 dark:text-amber-400">着手が{behind}日遅れ</span>
          )}
          <TaskMenu task={task} />
        </>
      }
    />
  );
}

/** 「これから」: いつから着手するかを主に見せる */
function UpcomingRow({ item, now }: { item: PrioritizedTask<TaskWithSource>; now: Date }) {
  const { task, startBy } = item;
  const urgency = urgencyOf({ deadline: task.deadline, now, startBy });
  return (
    <Row
      task={task}
      urgency={urgency}
      leading={<CompleteButton id={task.id} />}
      badge={<DueBadge deadline={task.deadline} now={now} urgency={urgency} />}
      meta={
        <>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{formatDateLabel(startBy)}から着手</span>
          <DeadlineText deadline={task.deadline} />
          <TaskMenu task={task} />
        </>
      }
    />
  );
}

/** 「見積もりを入れて」: 7択はメニューにしまい、「所要時間を選ぶ」ボタン1つにする */
function NeedsEstimateRow({ task, now }: { task: TaskWithSource; now: Date }) {
  const urgency = urgencyOf({ deadline: task.deadline, now });
  return (
    <Row
      task={task}
      urgency={urgency}
      leading={<CompleteButton id={task.id} />}
      badge={<DueBadge deadline={task.deadline} now={now} urgency={urgency} />}
      meta={
        <>
          <DeadlineText deadline={task.deadline} />
          <TaskMenu task={task} needsEstimate />
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 行の部品

const URGENCY_BAR: Record<Urgency, string> = {
  overdue: "bg-red-500",
  dueSoon: "bg-orange-400",
  behind: "bg-amber-400",
  normal: "bg-transparent",
};

const URGENCY_BADGE: Record<Urgency, string> = {
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  dueSoon: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  behind: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  normal: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * 1行の共通の形:
 *   [色の帯][完了ボタン] 件名                       [バッジ or 操作]
 *                        締切・所要時間・取り込み元
 */
function Row({
  task,
  urgency = "normal",
  leading,
  badge,
  meta,
  trailing,
  muted = false,
}: {
  task: TaskWithSource;
  urgency?: Urgency;
  leading?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  muted?: boolean;
}) {
  // フィード由来の件名は末尾の「[授業名]」を切り離し、取り込み元の横に小さく出す（手入力は打ったまま）
  const { title, course } = task.sourceId !== null ? splitCourseSuffix(task.title) : { title: task.title, course: null };
  return (
    <li className="relative flex gap-3 py-3 pr-3 pl-4">
      {!muted && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${URGENCY_BAR[urgency]}`} />}
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <p className={`min-w-0 break-words font-medium ${muted ? "text-zinc-400 line-through" : ""}`}>{title}</p>
          {badge}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
          {meta}
          <SourceTag name={task.sourceName} course={course} />
        </div>
      </div>
      {trailing && <div className="shrink-0 self-center">{trailing}</div>}
    </li>
  );
}

function DueBadge({ deadline, now, urgency }: { deadline: Date; now: Date; urgency: Urgency }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${URGENCY_BADGE[urgency]}`}>
      {dueBadgeLabel(deadline, now)}
    </span>
  );
}

function DeadlineText({ deadline }: { deadline: Date }) {
  return <span>{formatDeadline(deadline)} 締切</span>;
}

function SourceTag({ name, course }: { name: string | null; course: string | null }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-xs text-zinc-500">
      <span className="shrink-0 rounded border border-zinc-200 px-1.5 dark:border-zinc-700">{name ?? "手入力"}</span>
      {course && <span className="truncate">{course}</span>}
    </span>
  );
}

/**
 * 所要時間とその他の操作をしまったメニュー。
 * 見積もり前は目立つ「所要時間を選ぶ」ボタン、見積もり後は今の所要時間を出す小さなボタンにする。
 */
function TaskMenu({ task, needsEstimate = false }: { task: TaskWithSource; needsEstimate?: boolean }) {
  return (
    <details className="relative">
      <summary
        className={
          needsEstimate
            ? "cursor-pointer list-none rounded-md border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
            : "cursor-pointer list-none rounded-md px-1.5 py-0.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }
      >
        {needsEstimate ? "所要時間を選ぶ ▾" : `所要 ${formatEstimate(task.estimateMinutes!)} ▾`}
      </summary>
      <div className="absolute left-0 z-10 mt-2 flex w-72 max-w-[calc(100vw-3rem)] flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <div>
          <p className="mb-2 text-xs text-zinc-500">{needsEstimate ? "どのくらいかかりそう？" : "所要時間を変更"}</p>
          <EstimatePicker taskId={task.id} current={task.estimateMinutes} />
        </div>
        <div className="flex justify-end border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <TaskButton action={dismissTask} id={task.id} variant="subtle" label={`「${task.title}」をリストから削除`}>
            リストから削除
          </TaskButton>
        </div>
      </div>
    </details>
  );
}

function CompleteButton({ id }: { id: number }) {
  return (
    <form action={completeTask} className="pt-0.5">
      <input type="hidden" name="id" value={id} />
      <PendingButton
        type="submit"
        aria-label="完了にする"
        title="完了にする"
        className="size-5 rounded-full border-2 border-zinc-400 hover:border-green-600 hover:bg-green-50 dark:border-zinc-500 dark:hover:bg-green-950"
      />
    </form>
  );
}

function TaskButton({
  action,
  id,
  variant = "default",
  label,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  id: number;
  variant?: "default" | "danger" | "subtle";
  label?: string;
  children: ReactNode;
}) {
  const styles = {
    default: "border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
    danger:
      "border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950",
    subtle: "px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-red-700 dark:hover:bg-zinc-800",
  }[variant];
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <PendingButton type="submit" aria-label={label} className={`rounded-md text-sm ${styles}`}>
        {children}
      </PendingButton>
    </form>
  );
}
