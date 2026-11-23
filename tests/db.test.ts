import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createDb } from "@/db/client";
import { sources, tasks } from "@/db/schema";
import * as mutations from "@/db/mutations";
import { getTaskBoard } from "@/db/queries";
import { resetSyncAttempts, syncAllSources, syncSource, syncStaleSources } from "@/db/syncSources";

const now = new Date("2026-11-23T10:00:00+09:00");
const future = new Date("2026-12-05T14:59:00Z");

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
  resetSyncAttempts();
});

function addSource(name = "K-LMS", url = "https://example.com/feed.ics?token=SECRET") {
  return db.insert(sources).values({ name, url }).returning().get();
}

function calendar(...events: { uid: string; title: string; start: string }[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `SUMMARY:${e.title}`,
      `DTSTART:${e.start}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** 指定した本文を返す fetch の代わり */
const serve = (body: string, status = 200) => ({
  fetch: async () => new Response(body, { status }),
});

describe("スキーマの制約", () => {
  it("手入力の締切は source_id も external_uid も空で入れられ、既定値が入る", () => {
    const task = db.insert(tasks).values({ title: "ゼミ発表資料", deadline: future }).returning().get();
    expect(task).toMatchObject({
      sourceId: null,
      externalUid: null,
      estimateMinutes: null,
      status: "todo",
      kept: false,
    });
    expect(task.deadline).toEqual(future);
    expect(task.createdAt).toBeInstanceOf(Date);
  });

  it("source_id と external_uid は片方だけでは入れられない", () => {
    const source = addSource();
    expect(() =>
      db.insert(tasks).values({ title: "x", deadline: future, sourceId: source.id }).run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db.insert(tasks).values({ title: "x", deadline: future, externalUid: "a" }).run(),
    ).toThrow(/CHECK/);
  });

  it("所要時間は正の数だけ", () => {
    expect(() =>
      db.insert(tasks).values({ title: "x", deadline: future, estimateMinutes: 0 }).run(),
    ).toThrow(/CHECK/);
  });

  it("同じフィードに同じ UID は1件だけ", () => {
    const source = addSource();
    const row = { title: "x", deadline: future, sourceId: source.id, externalUid: "a" };
    db.insert(tasks).values(row).run();
    expect(() => db.insert(tasks).values(row).run()).toThrow(/UNIQUE/);
  });

  it("フィードを削除すると、そのフィード由来の締切も消える（手入力は残る）", () => {
    const source = addSource();
    db.insert(tasks)
      .values([
        { title: "フィード由来", deadline: future, sourceId: source.id, externalUid: "a" },
        { title: "手入力", deadline: future },
      ])
      .run();
    db.delete(sources).where(eq(sources.id, source.id)).run();
    expect(db.select({ title: tasks.title }).from(tasks).all()).toEqual([{ title: "手入力" }]);
  });
});

describe("syncSource", () => {
  it("新しい締切を取り込み、最終同期日時を記録する", async () => {
    const source = addSource();
    const result = await syncSource(
      db,
      source.id,
      now,
      serve(calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" })),
    );
    expect(result).toEqual({ sourceId: source.id, ok: true, inserted: 1, updated: 0, markedForCancel: 0 });
    expect(db.select().from(tasks).all()).toMatchObject([
      { sourceId: source.id, externalUid: "a", title: "レポート", status: "todo" },
    ]);
    expect(db.select().from(sources).get()).toMatchObject({ lastSyncedAt: now, lastSyncError: null });
  });

  it("再同期では件名と締切だけ更新し、所要時間と完了状態は残す", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve(calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" })));
    db.update(tasks).set({ estimateMinutes: 120, status: "done" }).run();

    await syncSource(
      db,
      source.id,
      now,
      serve(calendar({ uid: "a", title: "レポート（改訂）", start: "20261210T145900Z" })),
    );
    expect(db.select().from(tasks).get()).toMatchObject({
      title: "レポート（改訂）",
      deadline: new Date("2026-12-10T14:59:00Z"),
      estimateMinutes: 120,
      status: "done",
    });
  });

  it("フィードから消えたら「取り消し確認」、「残す」を選べば次の同期でもそのまま", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve(calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" })));

    const first = await syncSource(db, source.id, now, serve(calendar()));
    expect(first).toMatchObject({ ok: true, markedForCancel: 1 });
    expect(db.select().from(tasks).get()?.status).toBe("cancel_pending");

    // 画面で「残す」を選んだ
    db.update(tasks).set({ status: "todo", kept: true }).run();

    const second = await syncSource(db, source.id, now, serve(calendar()));
    expect(second).toMatchObject({ ok: true, updated: 0, markedForCancel: 0 });
    expect(db.select().from(tasks).get()).toMatchObject({ status: "todo", kept: true });
  });

  it("フィードごとに UID を区別する（別のフィードの同じ UID は別の締切）", async () => {
    const lms = addSource("K-LMS");
    const gcal = addSource("Googleカレンダー");
    const ics = calendar({ uid: "same", title: "予定", start: "20261204T145900Z" });
    await syncSource(db, lms.id, now, serve(ics));
    await syncSource(db, gcal.id, now, serve(ics));
    expect(db.select().from(tasks).all()).toHaveLength(2);
  });

  it("取得に失敗したらエラーを記録し、締切には触らない。メッセージに URL を含めない", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve(calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" })));

    const result = await syncSource(db, source.id, now, serve("", 500));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok || result.error).not.toContain("SECRET");
    expect(db.select().from(tasks).get()?.status).toBe("todo");
    expect(db.select().from(sources).get()?.lastSyncError).toContain("500");
  });

  it("次に成功したらエラーの記録を消す", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve("", 500));
    await syncSource(db, source.id, now, serve(calendar()));
    expect(db.select().from(sources).get()?.lastSyncError).toBeNull();
  });

  it("予期しないエラーは中身を出さずに一般的なメッセージにする", async () => {
    const source = addSource();
    const result = await syncSource(db, source.id, now, {
      fetch: async () => {
        throw new Error("https://example.com/feed.ics?token=SECRET で失敗");
      },
    });
    // fetch の例外は SyncError(network) に包まれるので URL は出ない
    expect(result.ok || result.error).not.toContain("SECRET");
  });
});

describe("syncAllSources", () => {
  it("1つのフィードが失敗しても他は同期する", async () => {
    const ok = addSource("ok", "https://example.com/ok.ics");
    const ng = addSource("ng", "https://example.com/ng.ics");
    const ics = calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" });
    const results = await syncAllSources(db, now, {
      fetch: async (input) =>
        String(input).includes("ok") ? new Response(ics) : new Response("", { status: 404 }),
    });
    expect(results).toEqual([
      { sourceId: ok.id, ok: true, inserted: 1, updated: 0, markedForCancel: 0 },
      { sourceId: ng.id, ok: false, error: expect.stringContaining("404") },
    ]);
  });
});

describe("syncStaleSources（画面を開いたときの自動同期）", () => {
  it("前回の試行から間隔があいていないフィードは取りに行かない（失敗した試行も数える）", async () => {
    addSource();
    let calls = 0;
    const fetchOptions = {
      fetch: async () => {
        calls++;
        return new Response("", { status: 500 });
      },
    };
    await syncStaleSources(db, now, { fetchOptions });
    await syncStaleSources(db, new Date(now.getTime() + 60_000), { fetchOptions });
    expect(calls).toBe(1);

    await syncStaleSources(db, new Date(now.getTime() + 5 * 60_000), { fetchOptions });
    expect(calls).toBe(2);
  });
});

describe("mutations", () => {
  const manual = () => mutations.addManualTask(db, { title: "手入力", deadline: future });
  const statusOf = (id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get()?.status;

  it("所要時間は7つの選択肢だけ受け付ける", () => {
    const id = manual();
    expect(mutations.setEstimate(db, id, 120)).toBe(true);
    expect(mutations.setEstimate(db, id, 45)).toBe(false);
    expect(db.select().from(tasks).get()?.estimateMinutes).toBe(120);
  });

  it("完了 → 戻す", () => {
    const id = manual();
    expect(mutations.completeTask(db, id)).toBe(true);
    expect(statusOf(id)).toBe("done");
    expect(mutations.completeTask(db, id)).toBe(false); // 完了済みはもう一度完了にできない
    expect(mutations.reopenTask(db, id)).toBe(true);
    expect(statusOf(id)).toBe("todo");
  });

  it("「残す」は取り消し確認中のものだけ", () => {
    const source = addSource();
    const id = db
      .insert(tasks)
      .values({ title: "x", deadline: future, sourceId: source.id, externalUid: "a", status: "cancel_pending" })
      .returning()
      .get().id;
    expect(mutations.keepTask(db, id)).toBe(true);
    expect(db.select().from(tasks).get()).toMatchObject({ status: "todo", kept: true });
    expect(mutations.keepTask(db, id)).toBe(false);
  });

  it("削除できるのは手入力と取り消し確認中のものだけ（フィードにあるものは消せない）", () => {
    const source = addSource();
    const feed = (uid: string, status: "todo" | "cancel_pending") =>
      db
        .insert(tasks)
        .values({ title: uid, deadline: future, sourceId: source.id, externalUid: uid, status })
        .returning()
        .get().id;
    const inFeed = feed("in-feed", "todo");
    const pending = feed("pending", "cancel_pending");
    const hand = manual();

    expect(mutations.deleteTask(db, inFeed)).toBe(false);
    expect(mutations.deleteTask(db, pending)).toBe(true);
    expect(mutations.deleteTask(db, hand)).toBe(true);
    expect(db.select({ id: tasks.id }).from(tasks).all()).toEqual([{ id: inFeed }]);
  });
});

describe("getTaskBoard", () => {
  it("未着手・取り消し確認・今日完了に分け、フィード名を付ける", () => {
    const source = addSource("K-LMS");
    const open = mutations.addManualTask(db, { title: "未着手", deadline: future });
    db.insert(tasks)
      .values({ title: "確認中", deadline: future, sourceId: source.id, externalUid: "a", status: "cancel_pending" })
      .run();
    const doneToday = mutations.addManualTask(db, { title: "今日完了", deadline: future });
    mutations.completeTask(db, doneToday);
    const doneBefore = mutations.addManualTask(db, { title: "昨日完了", deadline: future });
    db.update(tasks)
      .set({ status: "done", updatedAt: new Date("2026-11-22T12:00:00+09:00") })
      .where(eq(tasks.id, doneBefore))
      .run();

    // 「今日」は実時間で動くので、完了日時を基準に判定する
    const board = getTaskBoard(db, new Date());
    expect(board.open.map((t) => [t.id, t.sourceName])).toEqual([[open, null]]);
    expect(board.cancelPending.map((t) => [t.title, t.sourceName])).toEqual([["確認中", "K-LMS"]]);
    expect(board.doneToday.map((t) => t.title)).toEqual(["今日完了"]);
  });
});

describe("syncSource の細かい場合", () => {
  it("取得している間にフィードが削除されたら何も書き込まない", async () => {
    const source = addSource();
    const ics = calendar({ uid: "a", title: "レポート", start: "20261204T145900Z" });
    const result = await syncSource(db, source.id, now, {
      fetch: async () => {
        db.delete(sources).where(eq(sources.id, source.id)).run(); // 取得中に登録画面で削除された
        return new Response(ics);
      },
    });
    expect(result).toEqual({ sourceId: source.id, ok: false, error: "同期中にフィードが削除されました" });
    expect(db.select().from(tasks).all()).toEqual([]);
  });

  it("個別に同期したフィードは、自動同期の間隔のあいだ取りに行かない", async () => {
    const source = addSource();
    let calls = 0;
    const fetchOptions = {
      fetch: async () => {
        calls++;
        return new Response(calendar());
      },
    };
    await syncSource(db, source.id, now, fetchOptions); // 登録画面での取り込み
    await syncStaleSources(db, new Date(now.getTime() + 60_000), { fetchOptions }); // 直後にトップを開く
    expect(calls).toBe(1);
  });
});

describe("リストからの削除（dismissTask / restoreTask）", () => {
  const ics = calendar(
    { uid: "busy", title: "Busy", start: "20261204T145900Z" },
    { uid: "hw", title: "レポート", start: "20261205T145900Z" },
  );

  it("フィード由来は「削除済み」になり、再同期しても戻らない。戻すと未着手に戻る", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve(ics));
    const busy = db.select().from(tasks).where(eq(tasks.externalUid, "busy")).get()!;

    expect(mutations.dismissTask(db, busy.id)).toBe(true);
    expect(getTaskBoard(db, now)).toMatchObject({
      open: [expect.objectContaining({ title: "レポート" })],
      dismissed: [expect.objectContaining({ title: "Busy" })],
    });

    const resync = await syncSource(db, source.id, now, serve(ics));
    expect(resync).toMatchObject({ ok: true, inserted: 0, updated: 0 });
    expect(db.select().from(tasks).all()).toHaveLength(2);
    expect(db.select().from(tasks).where(eq(tasks.id, busy.id)).get()?.status).toBe("dismissed");

    expect(mutations.restoreTask(db, busy.id)).toBe(true);
    expect(db.select().from(tasks).where(eq(tasks.id, busy.id)).get()?.status).toBe("todo");
  });

  it("手入力はDBから消す（「削除済み」は残さない）", () => {
    const id = mutations.addManualTask(db, { title: "手入力", deadline: future });
    expect(mutations.dismissTask(db, id)).toBe(true);
    expect(db.select().from(tasks).all()).toEqual([]);
  });

  it("未着手でないもの（完了・取り消し確認）は削除しない", () => {
    const id = mutations.addManualTask(db, { title: "完了済み", deadline: future });
    mutations.completeTask(db, id);
    expect(mutations.dismissTask(db, id)).toBe(false);
    expect(mutations.restoreTask(db, id)).toBe(false); // 削除済みでないものは戻さない
  });

  it("手入力を「削除済み」にはできない（DBの制約）", () => {
    expect(() =>
      db.insert(tasks).values({ title: "x", deadline: future, status: "dismissed" }).run(),
    ).toThrow(/CHECK/);
  });

  it("締切が過ぎた「削除済み」は一覧に出さない", async () => {
    const source = addSource();
    await syncSource(db, source.id, now, serve(ics));
    for (const t of db.select().from(tasks).all()) mutations.dismissTask(db, t.id);
    expect(getTaskBoard(db, new Date("2026-12-05T10:00:00Z")).dismissed.map((t) => t.title)).toEqual(["レポート"]);
  });
});
