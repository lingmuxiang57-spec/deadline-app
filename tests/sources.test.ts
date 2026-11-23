import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createDb } from "@/db/client";
import { getSourcesWithTaskCount } from "@/db/queries";
import { sources, tasks } from "@/db/schema";
import { deleteSource, registerSource } from "@/db/sources";
import { resetSyncAttempts } from "@/db/syncSources";

const now = new Date("2026-11-23T10:00:00+09:00");

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  "BEGIN:VEVENT",
  "UID:a",
  "SUMMARY:レポート",
  "DTSTART:20261204T145900Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:b",
  "SUMMARY:小テスト",
  "DTSTART:20261210T145900Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const serve = (body: string, status = 200) => ({
  fetch: async () => new Response(body, { status }),
});

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
  resetSyncAttempts();
});

describe("registerSource", () => {
  it("登録してその場で取り込む。webcal:// は https:// にして保存する", async () => {
    const result = await registerSource(
      db,
      { name: " K-LMS ", url: "webcal://lms.example.jp/feed.ics?token=SECRET" },
      now,
      serve(ICS),
    );
    expect(result).toEqual({ ok: true, sourceId: 1, inserted: 2 });
    expect(db.select().from(sources).get()).toMatchObject({
      name: "K-LMS",
      url: "https://lms.example.jp/feed.ics?token=SECRET",
      lastSyncedAt: now,
    });
    expect(db.select().from(tasks).all()).toHaveLength(2);
  });

  it("取り込めなかったURLは登録しない", async () => {
    const result = await registerSource(
      db,
      { name: "K-LMS", url: "https://lms.example.jp/feed.ics?token=SECRET" },
      now,
      serve("", 404),
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("404") });
    expect(result.ok || result.error).toContain("登録はしていません");
    expect(result.ok || result.error).not.toContain("SECRET");
    expect(db.select().from(sources).all()).toEqual([]);
  });

  it("iCalでない内容（ログイン画面など）が返ってきても登録しない", async () => {
    const result = await registerSource(
      db,
      { name: "K-LMS", url: "https://lms.example.jp/login" },
      now,
      serve("<html>ログイン</html>"),
    );
    expect(result.ok).toBe(false);
    expect(db.select().from(sources).all()).toEqual([]);
  });

  it.each([
    [{ name: "", url: "https://example.com/a.ics" }, "名前を入力"],
    [{ name: "あ".repeat(41), url: "https://example.com/a.ics" }, "40文字以内"],
    [{ name: "K-LMS", url: "lms.example.jp/feed" }, "URLの形式"],
    [{ name: "K-LMS", url: "ftp://example.com/a.ics" }, "http(s)"],
  ])("入力が不正なら取りに行かずにエラー（%o）", async (input, message) => {
    let fetched = false;
    const result = await registerSource(db, input, now, {
      fetch: async () => {
        fetched = true;
        return new Response(ICS);
      },
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining(message) });
    expect(fetched).toBe(false);
  });

  it("同じURLは二重に登録しない（webcal:// と https:// の違いも同じとみなす）", async () => {
    await registerSource(db, { name: "K-LMS", url: "https://lms.example.jp/feed.ics" }, now, serve(ICS));
    const result = await registerSource(
      db,
      { name: "もう一度", url: "webcal://lms.example.jp/feed.ics" },
      now,
      serve(ICS),
    );
    expect(result).toEqual({ ok: false, error: "このURLは「K-LMS」として登録済みです" });
  });
});

describe("Google カレンダーの URL で失敗したときのヒント", () => {
  const google = "https://calendar.google.com/calendar/ical/someone%40gmail.com";

  it("公開URL（…/public/basic.ics）なら、非公開アドレスを使うよう案内する", async () => {
    const result = await registerSource(
      db,
      { name: "Googleカレンダー", url: `${google}/public/basic.ics` },
      now,
      serve("", 404),
    );
    expect(result.ok || result.error).toContain("HTTP 404");
    expect(result.ok || result.error).toContain("「iCal 形式の非公開アドレス」を使ってください");
  });

  it("末尾が .ics でなければ、コピーが途中で切れている可能性を伝える", async () => {
    const result = await registerSource(
      db,
      { name: "Googleカレンダー", url: `${google}/private-abc` },
      now,
      serve("", 404),
    );
    expect(result.ok || result.error).toContain("「…/basic.ics」で終わります");
  });

  it("非公開アドレスの形なら余計なヒントは付けない。Google 以外にも付けない", async () => {
    const privateUrl = await registerSource(
      db,
      { name: "Googleカレンダー", url: `${google}/private-abc/basic.ics` },
      now,
      serve("", 404),
    );
    expect(privateUrl.ok || privateUrl.error).toBe("フィードの取得に失敗しました（HTTP 404）。登録はしていません");

    const other = await registerSource(
      db,
      { name: "K-LMS", url: "https://lms.example.jp/public/basic.ics" },
      now,
      serve("", 404),
    );
    expect(other.ok || other.error).toBe("フィードの取得に失敗しました（HTTP 404）。登録はしていません");
  });
});

describe("deleteSource / getSourcesWithTaskCount", () => {
  it("フィードごとの締切の件数を数え、削除すると締切も消える（手入力は残る）", async () => {
    await registerSource(db, { name: "K-LMS", url: "https://lms.example.jp/feed.ics" }, now, serve(ICS));
    await registerSource(
      db,
      { name: "空のカレンダー", url: "https://calendar.example.com/empty.ics" },
      now,
      serve("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR"),
    );
    db.insert(tasks).values({ title: "手入力", deadline: now }).run();

    expect(getSourcesWithTaskCount(db).map((s) => [s.name, s.taskCount])).toEqual([
      ["K-LMS", 2],
      ["空のカレンダー", 0],
    ]);

    expect(deleteSource(db, 1)).toBe(true);
    expect(deleteSource(db, 1)).toBe(false);
    expect(db.select({ title: tasks.title }).from(tasks).all()).toEqual([{ title: "手入力" }]);
  });
});
