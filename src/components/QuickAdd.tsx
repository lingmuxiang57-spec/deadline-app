"use client";

import { useActionState, useState } from "react";
import { type QuickAddState, addQuickTask } from "@/app/actions";
import { formatDeadline } from "@/lib/format";
import { QUICK_ADD_ERROR_MESSAGES, type QuickAddResult, parseQuickAdd } from "@/lib/parseQuickAdd";

const INITIAL_STATE: QuickAddState = { status: "idle" };

/** 1行入力。「ゼミ発表資料 12/5」のように打つと、件名と締切をその場でプレビューする */
export function QuickAdd() {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<QuickAddResult | null>(null);

  const [state, formAction, pending] = useActionState(
    async (prev: QuickAddState, formData: FormData) => {
      const next = await addQuickTask(prev, formData);
      if (next.status === "added") {
        setText("");
        setPreview(null);
      }
      return next;
    },
    INITIAL_STATE,
  );

  function handleChange(value: string) {
    setText(value);
    setPreview(value.trim() === "" ? null : parseQuickAdd(value, new Date()));
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="quick-add" className="sr-only">
        締切を1行で追加
      </label>
      <div className="flex gap-2">
        <input
          id="quick-add"
          name="text"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="例: ゼミ発表資料 12/5"
          autoComplete="off"
          enterKeyHint="done"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending || text.trim() === ""}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          追加
        </button>
      </div>
      <p className="min-h-5 text-sm" aria-live="polite">
        {preview?.ok ? (
          <span className="text-zinc-600 dark:text-zinc-400">
            → <span className="font-medium text-zinc-900 dark:text-zinc-100">{preview.title}</span>
            {"　"}締切 {formatDeadline(preview.deadline)}
          </span>
        ) : preview && text.trim() !== "" ? (
          <span className="text-zinc-500">{QUICK_ADD_ERROR_MESSAGES[preview.error]}</span>
        ) : state.status === "error" ? (
          <span className="text-red-600 dark:text-red-400">{state.message}</span>
        ) : state.status === "added" ? (
          <span className="text-green-700 dark:text-green-400">「{state.title}」を追加しました</span>
        ) : null}
      </p>
    </form>
  );
}
