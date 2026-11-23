import { Suspense } from "react";
import { DeadlineBoard } from "@/components/DeadlineBoard";
import { QuickAdd } from "@/components/QuickAdd";
import { SiteNav } from "@/components/SiteNav";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">今日やるべきこと</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            締切ごとに、いつから着手すべきかを帯で示します。所要時間は1日8時間で日数に直しています。
          </p>
        </div>
        <SiteNav current="/" />
      </header>
      <div className="max-w-2xl">
        <QuickAdd />
      </div>
      {/* ?weeks= とDBの読み出しはリクエストごと。見出しと入力欄は先に表示される */}
      <Suspense fallback={<BoardFallback />}>
        <DeadlineBoard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function BoardFallback() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <p className="text-sm text-zinc-500">締切を読み込んでいます…</p>
      <div className="h-72 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
