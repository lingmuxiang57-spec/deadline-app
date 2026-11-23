import { Suspense } from "react";
import { QuickAdd } from "@/components/QuickAdd";
import { SiteNav } from "@/components/SiteNav";
import { TaskList } from "@/components/TaskList";
import { TWO_COLUMN_GRID } from "@/components/layout";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">今日やるべきこと</h1>
        <SiteNav current="/" />
      </header>
      <div className={TWO_COLUMN_GRID}>
        <QuickAdd />
      </div>
      {/* 締切の一覧はリクエストごとに同期・読み出しする。見出しと入力欄は先に表示される */}
      <Suspense fallback={<ListFallback />}>
        <TaskList />
      </Suspense>
    </main>
  );
}

function ListFallback() {
  const bar = "h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900";
  return (
    <div className={TWO_COLUMN_GRID} aria-busy="true">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">締切を読み込んでいます…</p>
        {[0, 1, 2].map((i) => (
          <div key={i} className={bar} />
        ))}
      </div>
      <div className="hidden flex-col gap-3 lg:flex">
        <div className="h-5" />
        {[0, 1].map((i) => (
          <div key={i} className={bar} />
        ))}
      </div>
    </div>
  );
}
