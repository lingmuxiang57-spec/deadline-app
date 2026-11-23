import type { Metadata } from "next";
import { Suspense } from "react";
import { AddSourceForm } from "@/components/AddSourceForm";
import { SiteNav } from "@/components/SiteNav";
import { SourceList } from "@/components/SourceList";

export const metadata: Metadata = {
  title: "フィードの登録 | 今日やるべきこと",
};

export default function SourcesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">フィードの登録</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            K-LMS や Google カレンダーの iCal URL を登録すると、締切を自動で取り込みます。
            リストを開くたびに同期します（同じフィードは5分に1回まで）。
          </p>
        </div>
        <SiteNav current="/sources" />
      </header>

      {/* 広い画面では「登録済み」と「追加する」を左右に並べる */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">登録済み</h2>
          <Suspense fallback={<div className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
            <SourceList />
          </Suspense>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="text-lg font-semibold">追加する</h2>
          <AddSourceForm />
          <details className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer font-medium">iCal URL の調べ方</summary>
            <div className="mt-3 flex flex-col gap-3 text-zinc-700 dark:text-zinc-300">
              <div>
                <p className="font-medium">K-LMS</p>
                <p>左のメニューの「カレンダー」を開き、画面右下の「カレンダーフィード」に表示される URL をコピーします。</p>
              </div>
              <div>
                <p className="font-medium">Google カレンダー</p>
                <p>
                  設定 → 左の「マイカレンダーの設定」で取り込むカレンダーを選び、「カレンダーの統合」にある
                  「iCal 形式の非公開アドレス」をコピーします。
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
                <li>この URL を知っている人は誰でも予定を読めます。人に見せたり、git にコミットしたりしないでください</li>
                <li>
                  繰り返し予定は、これから来る直近の1回だけ取り込みます。毎週のバイトなど不要なものは、1回「削除」すると以後の回も出なくなります
                </li>
                <li>締切が過ぎた予定は取り込みません</li>
              </ul>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
