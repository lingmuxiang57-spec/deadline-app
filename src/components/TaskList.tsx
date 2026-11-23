import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { completeTask, deleteTask, keepTask, reopenTask, syncNow } from "@/app/actions";
import { getDb } from "@/db/client";
import { type TaskWithSource, getSources, getTaskBoard } from "@/db/queries";
import { syncStaleSources } from "@/db/syncSources";
import { type DateKey, toDateKey } from "@/lib/date";
import { formatDateLabel, formatDeadline, formatEstimate, formatRelativeDay } from "@/lib/format";
import { type PrioritizedTask, prioritize } from "@/lib/priority";
import { EstimatePicker } from "./EstimatePicker";
import { PendingButton } from "./PendingButton";

/**
 * 今日やるべきリスト。開いたときにフィードを同期し、
 * 「取り消された？」「今日やる」「見積もりを入れて」「これから」「今日完了」に分けて出す。
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

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <p>
          {formatDateLabel(today)}
          {list.today.length > 0 ? ` ・ 今日やるもの ${list.today.length}件` : ""}
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
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
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
              today={today}
              now={now}
              actions={
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

      <Section title="今日やる" count={list.today.length} empty="今日着手すべき締切はありません">
        {list.today.map((item) => (
          <OpenRow key={item.task.id} item={item} today={today} now={now} />
        ))}
      </Section>

      {list.needsEstimate.length > 0 && (
        <Section
          title="見積もりを入れて"
          count={list.needsEstimate.length}
          note="所要時間を選ぶと、着手すべき日が決まってリストに並びます"
        >
          {list.needsEstimate.map((task) => (
            <Row
              key={task.id}
              task={task}
              today={today}
              now={now}
              leading={<CompleteButton id={task.id} />}
              below={<EstimatePicker taskId={task.id} current={null} />}
              actions={<DeleteIfManual task={task} />}
            />
          ))}
        </Section>
      )}

      {list.upcoming.length > 0 && (
        <Section title="これから" count={list.upcoming.length}>
          {list.upcoming.map((item) => (
            <OpenRow key={item.task.id} item={item} today={today} now={now} />
          ))}
        </Section>
      )}

      {board.doneToday.length > 0 && (
        <Section title="今日完了" count={board.doneToday.length}>
          {board.doneToday.map((task) => (
            <Row
              key={task.id}
              task={task}
              today={today}
              now={now}
              done
              actions={
                <TaskButton action={reopenTask} id={task.id}>
                  戻す
                </TaskButton>
              }
            />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  note,
  empty,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  empty?: string;
  children: ReactNode[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-lg font-semibold">
        {title}
        {count !== undefined && <span className="text-sm font-normal text-zinc-500">{count}件</span>}
      </h2>
      {note && <p className="text-sm text-zinc-500">{note}</p>}
      {children.length > 0 ? (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {children}
        </ul>
      ) : (
        empty && <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">{empty}</p>
      )}
    </section>
  );
}

/** 未着手で所要時間の入った締切の行（「今日やる」「これから」） */
function OpenRow({
  item,
  today,
  now,
}: {
  item: PrioritizedTask<TaskWithSource>;
  today: DateKey;
  now: Date;
}) {
  const { task, startBy } = item;
  const startLate = startBy < today;
  return (
    <Row
      task={task}
      today={today}
      now={now}
      leading={<CompleteButton id={task.id} />}
      extra={
        <span className={startLate ? "font-medium text-red-600 dark:text-red-400" : undefined}>
          着手 {formatDateLabel(startBy)}
          {startLate && `（${formatRelativeDay(today, startBy)}）`}
        </span>
      }
      actions={
        <div className="flex items-center gap-1">
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-full border border-zinc-300 px-2.5 py-0.5 text-sm text-zinc-700 hover:border-blue-500 dark:border-zinc-700 dark:text-zinc-300">
              {formatEstimate(task.estimateMinutes!)}
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <p className="mb-2 text-xs text-zinc-500">所要時間を変更</p>
              <EstimatePicker taskId={task.id} current={task.estimateMinutes} />
            </div>
          </details>
          <DeleteIfManual task={task} />
        </div>
      }
    />
  );
}

function Row({
  task,
  today,
  now,
  leading,
  extra,
  below,
  actions,
  done = false,
}: {
  task: TaskWithSource;
  today: DateKey;
  now: Date;
  leading?: ReactNode;
  extra?: ReactNode;
  below?: ReactNode;
  actions?: ReactNode;
  done?: boolean;
}) {
  const overdue = !done && task.deadline < now;
  return (
    <li className="flex gap-3 px-4 py-3">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <p className={`min-w-0 break-words font-medium ${done ? "text-zinc-400 line-through" : ""}`}>{task.title}</p>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-zinc-500">
          <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : undefined}>
            締切 {formatDeadline(task.deadline)}（{overdue ? "締切超過" : formatRelativeDay(today, toDateKey(task.deadline))}）
          </span>
          {extra}
          <span>{task.sourceName ?? "手入力"}</span>
        </p>
        {below}
      </div>
    </li>
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

function DeleteIfManual({ task }: { task: TaskWithSource }) {
  if (task.sourceId !== null) return null;
  return (
    <TaskButton action={deleteTask} id={task.id} variant="subtle" label={`「${task.title}」を削除`}>
      削除
    </TaskButton>
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
    danger: "border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950",
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
