"use client";

import { useActionState, useState } from "react";
import { type AddSourceState, addSourceAction } from "@/app/sources/actions";

const INITIAL_STATE: AddSourceState = { status: "idle" };

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-zinc-700 dark:bg-zinc-900";

/** フィードの登録。登録と同時に取り込み、取り込めなかったURLは登録しない */
export function AddSourceForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const [state, formAction, pending] = useActionState(
    async (prev: AddSourceState, formData: FormData) => {
      const next = await addSourceAction(prev, formData);
      if (next.status === "added") {
        setName("");
        setUrl("");
      }
      return next;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="source-name" className="text-sm font-medium">
          名前
        </label>
        <input
          id="source-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: K-LMS"
          maxLength={40}
          autoComplete="off"
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="source-url" className="text-sm font-medium">
          iCal URL
        </label>
        <input
          id="source-url"
          name="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… または webcal://…"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono text-sm`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || name.trim() === "" || url.trim() === ""}
          className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {pending ? "取り込み中…" : "登録して取り込む"}
        </button>
        <p className="text-sm" aria-live="polite">
          {state.status === "error" && !pending && (
            <span className="text-red-600 dark:text-red-400">{state.message}</span>
          )}
          {state.status === "added" && !pending && (
            <span className="text-green-700 dark:text-green-400">
              「{state.name}」を登録し、締切を{state.inserted}件取り込みました
            </span>
          )}
        </p>
      </div>
    </form>
  );
}
