import { connection } from "next/server";
import { syncNow } from "@/app/actions";
import { deleteSourceAction } from "@/app/sources/actions";
import { getDb } from "@/db/client";
import { getSourcesWithTaskCount } from "@/db/queries";
import { formatDateTime, maskFeedUrl } from "@/lib/format";
import { PendingButton } from "./PendingButton";

/** 登録済みのフィード一覧。URLはホスト名だけ見せる */
export async function SourceList() {
  await connection();
  const sources = getSourcesWithTaskCount(getDb());

  if (sources.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
        まだ登録していません
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {sources.map((source) => (
          <li key={source.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{source.name}</p>
                <p className="truncate font-mono text-xs text-zinc-500">{maskFeedUrl(source.url)}</p>
              </div>
              <details className="group relative shrink-0">
                <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-red-700 dark:hover:bg-zinc-800">
                  削除
                </summary>
                <div className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  <p>
                    「{source.name}」と、取り込んだ締切{source.taskCount}件を削除します。手入力の締切は残ります。
                  </p>
                  <form action={deleteSourceAction} className="mt-3 flex justify-end">
                    <input type="hidden" name="id" value={source.id} />
                    <PendingButton
                      type="submit"
                      className="rounded-md border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      削除する
                    </PendingButton>
                  </form>
                </div>
              </details>
            </div>
            <p className="flex flex-wrap gap-x-3 text-sm text-zinc-500">
              <span>締切 {source.taskCount}件</span>
              <span>
                {source.lastSyncedAt ? `最終同期 ${formatDateTime(source.lastSyncedAt)}` : "未同期"}
              </span>
            </p>
            {source.lastSyncError && (
              <p className="text-sm text-amber-700 dark:text-amber-300">同期に失敗しました：{source.lastSyncError}</p>
            )}
          </li>
        ))}
      </ul>
      <form action={syncNow} className="self-end">
        <PendingButton type="submit" className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          すべて今すぐ同期
        </PendingButton>
      </form>
    </div>
  );
}
