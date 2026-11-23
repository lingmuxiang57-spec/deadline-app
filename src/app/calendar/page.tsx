import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteNav } from "@/components/SiteNav";
import { TaskTimeline } from "@/components/TaskTimeline";

export const metadata: Metadata = {
  title: "カレンダー | 今日やるべきこと",
};

export default function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">カレンダー</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            いつから着手すべきかを帯で示します。所要時間は1日8時間で日数に直しています。
          </p>
        </div>
        <SiteNav current="/calendar" />
      </header>
      {/* ?weeks= とDBの読み出しはリクエストごと。見出しは先に表示される */}
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" aria-busy="true" />}>
        <TaskTimeline searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
