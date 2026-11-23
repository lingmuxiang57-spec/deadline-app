import { Suspense } from "react";
import { QuickAdd } from "@/components/QuickAdd";
import { TaskList } from "@/components/TaskList";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:py-12">
      <header>
        <h1 className="text-2xl font-bold">今日やるべきこと</h1>
      </header>
      <QuickAdd />
      {/* 締切の一覧はリクエストごとに同期・読み出しする。見出しと入力欄は先に表示される */}
      <Suspense fallback={<ListFallback />}>
        <TaskList />
      </Suspense>
    </main>
  );
}

function ListFallback() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p className="text-sm text-zinc-500">締切を読み込んでいます…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}
