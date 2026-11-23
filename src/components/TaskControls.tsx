import type { ReactNode } from "react";
import { changeDeadline, completeTask, dismissTask, resetDeadline } from "@/app/actions";
import type { TaskWithSource } from "@/db/queries";
import { toDeadlineInputValues } from "@/lib/deadlineInput";
import { formatDeadline, formatEstimate } from "@/lib/format";
import { EstimatePicker } from "./EstimatePicker";
import { PendingButton } from "./PendingButton";

/** 完了にする丸いボタン */
export function CompleteButton({ id, label }: { id: number; label: string }) {
  return (
    <form action={completeTask} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <PendingButton
        type="submit"
        aria-label={`「${label}」を完了にする`}
        title="完了にする"
        className="block size-[18px] rounded-full border-2 border-zinc-400 hover:border-green-600 hover:bg-green-50 dark:border-zinc-500 dark:hover:bg-green-950"
      />
    </form>
  );
}

/**
 * 所要時間・締切の変更・リストからの削除をしまったメニュー。
 * タイムラインは横にスクロールする枠の中にあり、浮かせたメニューは枠で切れてしまうので、行の中で下に開く。
 * 見積もり前は目立つ「所要時間を選ぶ」、見積もり後は今の所要時間を出す小さなボタンにする。
 */
export function TaskMenu({ task, label }: { task: TaskWithSource; label: string }) {
  const { id, estimateMinutes } = task;
  const needsEstimate = estimateMinutes === null;
  return (
    <details className="group/menu">
      <summary
        className={
          needsEstimate
            ? "inline-block cursor-pointer list-none rounded-md border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
            : "inline-block cursor-pointer list-none rounded-md px-1 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }
      >
        {needsEstimate ? "所要時間を選ぶ" : `所要 ${formatEstimate(estimateMinutes)}`}
        <span className="ml-0.5 inline-block transition-transform group-open/menu:rotate-180">▾</span>
      </summary>
      <div className="mt-2 flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/60">
        <p className="text-xs text-zinc-500">{needsEstimate ? "どのくらいかかりそう？" : "所要時間を変更"}</p>
        <EstimatePicker taskId={id} current={estimateMinutes} />
        <DeadlineForm task={task} />
        <div className="flex justify-end border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <TaskButton action={dismissTask} id={id} variant="subtle" label={`「${label}」をリストから削除`}>
            リストから削除
          </TaskButton>
        </div>
      </div>
    </details>
  );
}

/**
 * 締切の変更。日付は必須、時刻は空ならその日の 23:59。
 * フィード由来の締切を変えたときは、フィードに書かれている締切と「フィードの締切に戻す」を出す
 */
function DeadlineForm({ task }: { task: TaskWithSource }) {
  const current = toDeadlineInputValues(task.deadline);
  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-sm dark:border-zinc-600 dark:bg-zinc-900";
  return (
    <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-700">
      <p className="text-xs text-zinc-500">締切を変更（時刻を空にするとその日の 23:59）</p>
      {/* 締切が変わったら入力欄を作り直して、初期値を新しい締切にそろえる */}
      <form key={task.deadline.getTime()} action={changeDeadline} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="date" name="date" required defaultValue={current.date} aria-label="締切の日付" className={inputClass} />
        <input type="time" name="time" defaultValue={current.time} aria-label="締切の時刻" className={inputClass} />
        <PendingButton
          type="submit"
          className="rounded-md border border-zinc-300 px-2 py-0.5 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          変更
        </PendingButton>
      </form>
      {task.feedDeadline && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>
            {task.sourceName ?? "フィード"}の締切: {formatDeadline(task.feedDeadline)}
          </span>
          <TaskButton action={resetDeadline} id={task.id} variant="subtle">
            フィードの締切に戻す
          </TaskButton>
        </div>
      )}
    </div>
  );
}

export function TaskButton({
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
    subtle: "px-2 py-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-700 dark:hover:bg-zinc-800",
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
