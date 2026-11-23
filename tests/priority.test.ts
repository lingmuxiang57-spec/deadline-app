import { describe, expect, it } from "vitest";
import { ESTIMATE_OPTIONS, prioritize, requiredDays, startByDate } from "@/lib/priority";

/** 日本時間の日時を Date にする（例: jst("2026-12-05T09:00")） */
const jst = (local: string) => new Date(`${local}:00+09:00`);

const minutesOf = (label: (typeof ESTIMATE_OPTIONS)[number]["label"]) =>
  ESTIMATE_OPTIONS.find((o) => o.label === label)!.minutes;

describe("README の表どおりの着手期限（締切 12/5）", () => {
  const deadline = jst("2026-12-05T09:00");
  it.each([
    ["30分", 1, "2026-12-04"],
    ["2時間", 1, "2026-12-04"],
    ["半日", 1, "2026-12-04"],
    ["1日", 1, "2026-12-04"],
    ["2日", 2, "2026-12-03"],
    ["3日", 3, "2026-12-02"],
    ["1週間", 7, "2026-11-28"],
  ] as const)("%s → 必要日数 %i日、着手期限 %s", (label, days, startBy) => {
    const minutes = minutesOf(label);
    expect(requiredDays(minutes)).toBe(days);
    expect(startByDate(deadline, minutes)).toBe(startBy);
  });
});

describe("requiredDays", () => {
  it("8時間を少しでも超えたら2日", () => {
    expect(requiredDays(8 * 60 + 1)).toBe(2);
  });
  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])(
    "不正な所要時間 %s はエラー",
    (minutes) => {
      expect(() => requiredDays(minutes)).toThrow(RangeError);
    },
  );
});

describe("prioritize", () => {
  type Task = { id: string; deadline: Date; estimateMinutes: number | null };
  const task = (id: string, deadline: string, estimateMinutes: number | null): Task => ({
    id,
    deadline: jst(deadline),
    estimateMinutes,
  });
  const ids = (list: { task: Task }[]) => list.map((t) => t.task.id);

  const now = jst("2026-11-28T10:00");

  it("着手期限が今日以前なら「今日やる」、明日以降なら「これから」", () => {
    const result = prioritize(
      [
        task("startToday", "2026-12-05T09:00", minutesOf("1週間")), // 着手 11/28
        task("overdueStart", "2026-11-29T09:00", minutesOf("2日")), // 着手 11/27
        task("startTomorrow", "2026-11-30T09:00", minutesOf("30分")), // 着手 11/29
      ],
      now,
    );
    expect(ids(result.today)).toEqual(["overdueStart", "startToday"]);
    expect(ids(result.upcoming)).toEqual(["startTomorrow"]);
  });

  it("「今日」も日本時間で判定する（JST 0:00 になった瞬間に切り替わる）", () => {
    const t = task("a", "2026-11-30T09:00", minutesOf("30分")); // 着手 11/29
    expect(prioritize([t], jst("2026-11-28T23:59")).today).toHaveLength(0);
    expect(prioritize([t], new Date("2026-11-28T15:00:00Z")).today).toHaveLength(1);
  });

  it("締切を過ぎたものも「今日やる」に残る", () => {
    const result = prioritize([task("late", "2026-11-27T09:00", 30)], now);
    expect(ids(result.today)).toEqual(["late"]);
  });

  it("着手期限が同じなら締切が早い順", () => {
    const result = prioritize(
      [
        task("later", "2026-12-10T09:00", minutesOf("2日")), // 着手 12/8
        task("earlier", "2026-12-09T09:00", minutesOf("1日")), // 着手 12/8
      ],
      now,
    );
    expect(ids(result.upcoming)).toEqual(["earlier", "later"]);
  });

  it("締切が同じ日でも時刻が早い方を先にする", () => {
    const result = prioritize(
      [task("evening", "2026-12-09T18:00", 30), task("morning", "2026-12-09T09:00", 30)],
      now,
    );
    expect(ids(result.upcoming)).toEqual(["morning", "evening"]);
  });

  it("着手期限も締切も同じなら所要時間が長い順", () => {
    const result = prioritize(
      [
        task("short", "2026-12-09T09:00", minutesOf("30分")),
        task("long", "2026-12-09T09:00", minutesOf("1日")),
      ],
      now,
    );
    expect(ids(result.upcoming)).toEqual(["long", "short"]);
  });

  it("所要時間が未入力なら「見積もりを入れて」に分け、締切が早い順に並べる", () => {
    const result = prioritize(
      [
        task("noEstimateLate", "2026-12-20T09:00", null),
        task("estimated", "2026-12-05T09:00", 30),
        task("noEstimateSoon", "2026-11-29T09:00", null),
      ],
      now,
    );
    expect(result.needsEstimate.map((t) => t.id)).toEqual(["noEstimateSoon", "noEstimateLate"]);
    expect(ids([...result.today, ...result.upcoming])).toEqual(["estimated"]);
  });

  it("着手期限・必要日数・締切日を返す", () => {
    const [item] = prioritize([task("a", "2026-12-05T09:00", minutesOf("3日"))], now).upcoming;
    expect(item).toMatchObject({
      deadlineDate: "2026-12-05",
      requiredDays: 3,
      startBy: "2026-12-02",
    });
  });

  it("入力の配列を書き換えない", () => {
    const tasks = [task("b", "2026-12-10T09:00", 30), task("a", "2026-12-01T09:00", 30)];
    prioritize(tasks, now);
    expect(tasks.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("締切が不正な日時ならエラー（見積もり未入力でも）", () => {
    expect(() =>
      prioritize([{ id: "x", deadline: new Date("invalid"), estimateMinutes: null }], now),
    ).toThrow(RangeError);
  });

  it("空なら空", () => {
    expect(prioritize([], now)).toEqual({ today: [], upcoming: [], needsEstimate: [] });
  });
});
