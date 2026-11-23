import { describe, expect, it, vi } from "vitest";
import {
  type FeedEvent,
  type SyncedTask,
  SyncError,
  fetchIcs,
  normalizeFeedUrl,
  parseIcs,
  planSync,
  syncFeed,
} from "@/lib/sync";

const now = new Date("2026-11-23T10:00:00+09:00");

/** VEVENT の行をまとめて VCALENDAR にする（iCal の改行は CRLF） */
function calendar(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Tokyo",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0900",
    "TZOFFSETTO:+0900",
    "TZNAME:JST",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...events.map((e) => `BEGIN:VEVENT\n${e.trim()}\nEND:VEVENT`),
    "END:VCALENDAR",
  ]
    .join("\n")
    .replace(/\n\s*/g, "\r\n");
}

const iso = (events: FeedEvent[]) =>
  events.map((e) => ({ uid: e.externalUid, title: e.title, at: e.deadline.toISOString() }));

describe("parseIcs: 日時の読み取り", () => {
  it("UTC（K-LMS の課題の形式）", () => {
    const ics = calendar(`
      UID:assignment-1
      SUMMARY:レポート課題
      DTSTART:20261204T145900Z
    `);
    expect(iso(parseIcs(ics))).toEqual([
      { uid: "assignment-1", title: "レポート課題", at: "2026-12-04T14:59:00.000Z" },
    ]);
  });

  it("VTIMEZONE のある TZID（Google カレンダーの形式）", () => {
    const ics = calendar(`
      UID:interview
      SUMMARY:面接
      DTSTART;TZID=Asia/Tokyo:20261205T090000
    `);
    expect(parseIcs(ics)[0].deadline.toISOString()).toBe("2026-12-05T00:00:00.000Z");
  });

  it("タイムゾーンなし（浮動時刻）は日本時間として読む", () => {
    const ics = calendar(`
      UID:floating
      DTSTART:20261205T090000
    `);
    expect(parseIcs(ics)[0].deadline.toISOString()).toBe("2026-12-05T00:00:00.000Z");
  });

  it("VTIMEZONE のない TZID は IANA 名として読む", () => {
    const ics = calendar(`
      UID:ny
      DTSTART;TZID=America/New_York:20261205T090000
    `);
    expect(parseIcs(ics)[0].deadline.toISOString()).toBe("2026-12-05T14:00:00.000Z");
  });

  it("知らない TZID は日本時間として読む", () => {
    const ics = calendar(`
      UID:unknown-tz
      DTSTART;TZID=Custom Zone:20261205T090000
    `);
    expect(parseIcs(ics)[0].deadline.toISOString()).toBe("2026-12-05T00:00:00.000Z");
  });

  it("終日の予定はその日の 23:59（日本時間）", () => {
    const ics = calendar(`
      UID:allday
      SUMMARY:ES締切
      DTSTART;VALUE=DATE:20261205
    `);
    expect(parseIcs(ics)[0].deadline.toISOString()).toBe("2026-12-05T14:59:00.000Z");
  });
});

describe("parseIcs: 件名・UID・状態", () => {
  it("件名がなければ（無題）", () => {
    const ics = calendar(`
      UID:no-title
      DTSTART:20261204T145900Z
    `);
    expect(parseIcs(ics)[0].title).toBe("（無題）");
  });

  it("UID のない予定は照合できないので読み飛ばす", () => {
    const ics = calendar(`
      SUMMARY:UIDなし
      DTSTART:20261204T145900Z
    `);
    expect(parseIcs(ics)).toEqual([]);
  });

  it("STATUS:CANCELLED の予定は読み飛ばす", () => {
    const ics = calendar(`
      UID:cancelled
      STATUS:CANCELLED
      DTSTART:20261204T145900Z
    `);
    expect(parseIcs(ics)).toEqual([]);
  });

  it("過去の単発の予定も返す（追加するかは planSync が決める）", () => {
    const ics = calendar(`
      UID:past
      DTSTART:20261101T145900Z
    `);
    expect(parseIcs(ics)).toHaveLength(1);
  });

  it("壊れた本文は SyncError(parse)", () => {
    expect(() => parseIcs("BEGIN:VCALENDAR\r\nBROKEN")).toThrow(SyncError);
  });
});

describe("parseIcs: 繰り返し予定は取り込まない", () => {
  const single = `
    UID:es
    SUMMARY:ES締切
    DTSTART;TZID=Asia/Tokyo:20261205T120000
  `;

  it("RRULE の予定（毎週のバイトなど）は読み飛ばす", () => {
    const weekly = `
      UID:baito
      SUMMARY:バイト
      DTSTART;TZID=Asia/Tokyo:20261116T180000
      RRULE:FREQ=WEEKLY
    `;
    expect(parseIcs(calendar(weekly, single)).map((e) => e.externalUid)).toEqual(["es"]);
  });

  it("RDATE の予定も読み飛ばす", () => {
    const rdate = `
      UID:seminar
      SUMMARY:ゼミ
      DTSTART;TZID=Asia/Tokyo:20261201T130000
      RDATE;TZID=Asia/Tokyo:20261208T130000
    `;
    expect(parseIcs(calendar(rdate, single)).map((e) => e.externalUid)).toEqual(["es"]);
  });

  it("繰り返し予定の個別変更（RECURRENCE-ID）も読み飛ばす", () => {
    const moved = `
      UID:baito
      RECURRENCE-ID;TZID=Asia/Tokyo:20261207T180000
      SUMMARY:バイト（時間変更）
      DTSTART;TZID=Asia/Tokyo:20261207T200000
    `;
    expect(parseIcs(calendar(moved, single)).map((e) => e.externalUid)).toEqual(["es"]);
  });
});

describe("planSync", () => {
  const future = new Date("2026-12-05T14:59:00Z");
  const past = new Date("2026-11-01T14:59:00Z");
  const task = (overrides: Partial<SyncedTask> & Pick<SyncedTask, "id" | "externalUid">): SyncedTask => ({
    title: "課題",
    deadline: future,
    status: "todo",
    kept: false,
    ...overrides,
  });
  const event = (externalUid: string, overrides: Partial<FeedEvent> = {}): FeedEvent => ({
    externalUid,
    title: "課題",
    deadline: future,
    ...overrides,
  });

  it("変化がなければ何もしない", () => {
    expect(planSync([task({ id: 1, externalUid: "a" })], [event("a")], now)).toEqual({
      inserts: [],
      updates: [],
    });
  });

  it("件名と締切が変わったら、変わった項目だけ更新する", () => {
    const later = new Date("2026-12-10T14:59:00Z");
    const plan = planSync(
      [task({ id: 1, externalUid: "a" }), task({ id: 2, externalUid: "b" })],
      [event("a", { title: "課題（改訂）" }), event("b", { deadline: later })],
      now,
    );
    expect(plan.updates).toEqual([
      { id: 1, changes: { title: "課題（改訂）" } },
      { id: 2, changes: { deadline: later } },
    ]);
  });

  it("完了済みのものは件名・締切が変わっても完了のまま（状態を書き換えない）", () => {
    const plan = planSync(
      [task({ id: 1, externalUid: "a", status: "done" })],
      [event("a", { title: "新しい件名" })],
      now,
    );
    expect(plan.updates).toEqual([{ id: 1, changes: { title: "新しい件名" } }]);
  });

  it("フィードから消えた未着手・締切が未来のものは「取り消し確認」にする", () => {
    const plan = planSync([task({ id: 1, externalUid: "a" })], [], now);
    expect(plan.updates).toEqual([{ id: 1, changes: { status: "cancel_pending" } }]);
  });

  it("消えても、締切が過去のもの・完了済みのもの・すでに確認中のものはそのまま", () => {
    const plan = planSync(
      [
        task({ id: 1, externalUid: "past", deadline: past }),
        task({ id: 2, externalUid: "done", status: "done" }),
        task({ id: 3, externalUid: "pending", status: "cancel_pending" }),
      ],
      [],
      now,
    );
    expect(plan.updates).toEqual([]);
  });

  it("「取り消し確認」のものがフィードに戻ったら未着手に戻す", () => {
    const plan = planSync(
      [task({ id: 1, externalUid: "a", status: "cancel_pending" })],
      [event("a")],
      now,
    );
    expect(plan.updates).toEqual([{ id: 1, changes: { status: "todo" } }]);
  });

  it("「残す」を選んだものは、フィードになくても次の同期で確認に戻さない", () => {
    const plan = planSync([task({ id: 1, externalUid: "a", kept: true })], [], now);
    expect(plan.updates).toEqual([]);
  });

  it("「残す」を選んだものがフィードに戻ったら、件名・締切の変更は反映し、二重に追加しない", () => {
    const later = new Date("2026-12-10T14:59:00Z");
    const plan = planSync(
      [task({ id: 1, externalUid: "a", kept: true })],
      [event("a", { deadline: later })],
      now,
    );
    expect(plan).toEqual({ inserts: [], updates: [{ id: 1, changes: { deadline: later } }] });
  });

  it("新しいものは締切が未来のものだけ追加する", () => {
    const plan = planSync([], [event("new"), event("old", { deadline: past })], now);
    expect(plan.inserts.map((e) => e.externalUid)).toEqual(["new"]);
  });

  it("同じ UID が重複して届いたら1件だけ追加する", () => {
    const plan = planSync([], [event("dup", { title: "1つ目" }), event("dup", { title: "2つ目" })], now);
    expect(plan.inserts).toEqual([event("dup", { title: "1つ目" })]);
  });
});

describe("fetchIcs / normalizeFeedUrl", () => {
  const okResponse = (body: string, status = 200) => new Response(body, { status });

  it("webcal:// を https:// に直す", () => {
    expect(normalizeFeedUrl("webcal://example.com/feed.ics")).toBe("https://example.com/feed.ics");
  });

  it.each(["not a url", "ftp://example.com/feed.ics", "javascript:alert(1)"])(
    "「%s」は invalidUrl",
    (url) => {
      expect(() => normalizeFeedUrl(url)).toThrow(expect.objectContaining({ kind: "invalidUrl" }));
    },
  );

  it("取得した本文を返す", async () => {
    const fetchMock = vi.fn(async () => okResponse(calendar()));
    await expect(fetchIcs("webcal://example.com/feed.ics", { fetch: fetchMock })).resolves.toContain(
      "BEGIN:VCALENDAR",
    );
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/feed.ics", expect.any(Object));
  });

  it("HTTP エラーは SyncError(http)。メッセージに URL を含めない", async () => {
    const secretUrl = "https://example.com/feed.ics?token=SECRET";
    const error = await fetchIcs(secretUrl, { fetch: async () => okResponse("", 404) }).catch((e) => e);
    expect(error).toMatchObject({ kind: "http" });
    expect(error.message).toContain("404");
    expect(error.message).not.toContain("SECRET");
  });

  it("接続できなければ SyncError(network)", async () => {
    const fetchMock = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchIcs("https://example.com/feed.ics", { fetch: fetchMock })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("iCal でない本文（ログイン画面の HTML など）は SyncError(notCalendar)", async () => {
    await expect(
      fetchIcs("https://example.com/feed.ics", { fetch: async () => okResponse("<html></html>") }),
    ).rejects.toMatchObject({ kind: "notCalendar" });
  });
});

describe("syncFeed", () => {
  it("取得 → 解析 → 照合をまとめて行う", async () => {
    const ics = calendar(`
      UID:new-assignment
      SUMMARY:新しい課題
      DTSTART:20261204T145900Z
    `);
    const plan = await syncFeed({
      url: "https://example.com/feed.ics",
      existing: [
        {
          id: 1,
          externalUid: "gone",
          title: "消えた課題",
          deadline: new Date("2026-12-01T14:59:00Z"),
          status: "todo",
          kept: false,
        },
      ],
      now,
      fetchOptions: { fetch: async () => new Response(ics) },
    });
    expect(plan.inserts.map((e) => e.title)).toEqual(["新しい課題"]);
    expect(plan.updates).toEqual([{ id: 1, changes: { status: "cancel_pending" } }]);
  });
});
