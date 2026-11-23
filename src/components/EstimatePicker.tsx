import { setEstimate } from "@/app/actions";
import { ESTIMATE_OPTIONS } from "@/lib/priority";
import { PendingButton } from "./PendingButton";

/** 所要時間の7択。押したボタンの値（minutes）がそのまま送られる */
export function EstimatePicker({ taskId, current }: { taskId: number; current: number | null }) {
  return (
    <form action={setEstimate} className="flex flex-wrap gap-1.5">
      <input type="hidden" name="id" value={taskId} />
      {ESTIMATE_OPTIONS.map((option) => {
        const selected = option.minutes === current;
        return (
          <PendingButton
            key={option.minutes}
            type="submit"
            name="minutes"
            value={option.minutes}
            aria-pressed={selected}
            className={
              selected
                ? "rounded-full border border-blue-600 bg-blue-600 px-3 py-1 text-sm text-white"
                : "rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm hover:border-blue-500 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:text-blue-300"
            }
          >
            {option.label}
          </PendingButton>
        );
      })}
    </form>
  );
}
