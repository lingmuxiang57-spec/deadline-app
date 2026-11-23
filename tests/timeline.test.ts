import { describe, expect, it } from "vitest";
import { prioritize } from "@/lib/priority";
import { buildTimeline } from "@/lib/timeline";

// 今日 = 2026-11-23（月）
const now = new Date("2026-11-23T10:00:00+09:00");
const today = "2026-11-23";

type Task = { id: string; deadline: Date; estimateMinutes: number | null };
const task = (id: string, deadline: string, estimateMinutes: number | null): Task => ({
  id,
  deadline: new Date(`${deadline}:00+09:00`),
  estimateMinutes,
});
const DAY = 8 * 60;

function timeline(tasks: Task[], days = 14) {
  return buildTimeline(prioritize(tasks, now), today, days);
}
const rowOf = (t: ReturnType<typeof timeline>, id: string) => t.rows.find((r) => r.task.id === id);

describe("buildTimeline", () => {
  it("横軸は今日から指定日数ぶん", () => {
    const t = timeline([], 3);
    expect(t.days).toEqual(["2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(t.load).toEqual([0, 0, 0]);
  });

  it("帯は着手すべき日から締切の前日まで（必要日数ぶん）、◆は締切日", () => {
    // 締切 12/5、3日 → 着手 12/2。帯は 12/2〜12/4、◆は 12/5
    const t = timeline([task("seminar", "2026-12-05T23:59", 3 * DAY)]);
    expect(rowOf(t, "seminar")).toMatchObject({
      group: "upcoming",
      startBy: "2026-12-02",
      bar: { start: 9, end: 11, clippedStart: false, clippedEnd: false },
      deadlineCol: 12,
      afterRange: false,
    });
  });

  it("着手すべき日を過ぎていたら、帯を今日に切り詰めて遅れの印を付ける", () => {
    // 締切 11/26、1週間 → 着手 11/19（4日前）
    const t = timeline([task("late", "2026-11-26T23:59", 7 * DAY)]);
    expect(rowOf(t, "late")).toMatchObject({
      group: "today",
      bar: { start: 0, end: 2, clippedStart: true, clippedEnd: false },
    });
  });

  it("帯が範囲の後ろまで続くなら切り詰める。◆が範囲外なら null", () => {
    // 締切 12/10、1週間 → 着手 12/3（col 10）。範囲は 14日（col 0〜13）
    const t = timeline([task("long", "2026-12-10T23:59", 7 * DAY)]);
    expect(rowOf(t, "long")).toMatchObject({
      bar: { start: 10, end: 13, clippedStart: false, clippedEnd: true },
      deadlineCol: null,
      afterRange: false,
    });
  });

  it("締切が今日なら作業期間は範囲内に残っていない（帯なし、◆は今日）", () => {
    const t = timeline([task("due", "2026-11-23T23:59", 2 * 60)]);
    expect(rowOf(t, "due")).toMatchObject({ bar: null, deadlineCol: 0 });
  });

  it("締切を過ぎたものは帯も◆もなし（行は残す）", () => {
    const t = timeline([task("overdue", "2026-11-20T23:59", 30)]);
    expect(rowOf(t, "overdue")).toMatchObject({ group: "today", bar: null, deadlineCol: null, afterRange: false });
  });

  it("着手すべき日が範囲より後のものも、操作できるよう行として返す（帯も◆もなし）", () => {
    const t = timeline([task("far", "2027-01-25T16:00", 7 * DAY)]);
    expect(rowOf(t, "far")).toMatchObject({
      group: "upcoming",
      bar: null,
      deadlineCol: null,
      startBy: "2027-01-18",
      afterRange: true,
    });
    expect(t.load.every((n) => n === 0)).toBe(true);
  });

  it("日ごとの重なりを数える", () => {
    const t = timeline(
      [
        task("a", "2026-11-26T23:59", 3 * DAY), // 帯 11/23〜25（col 0〜2）
        task("b", "2026-11-26T23:59", 2 * DAY), // 帯 11/24〜25（col 1〜2）
      ],
      5,
    );
    expect(t.load).toEqual([1, 2, 2, 0, 0]);
  });

  it("「今日やる」「見積もりを入れて」「これから」の順に並ぶ。見積もり待ちは◆だけ", () => {
    const t = timeline([
      task("upcoming", "2026-12-01T23:59", 30),
      task("noEstimate2", "2026-11-30T23:59", null),
      task("today", "2026-11-24T23:59", 30),
      task("noEstimate1", "2026-11-25T23:59", null),
      task("noEstimateFar", "2027-02-01T23:59", null),
    ]);
    expect(t.rows.map((r) => [r.task.id, r.group, r.bar, r.deadlineCol, r.afterRange])).toEqual([
      ["today", "today", { start: 0, end: 0, clippedStart: false, clippedEnd: false }, 1, false],
      ["noEstimate1", "needsEstimate", null, 2, false],
      ["noEstimate2", "needsEstimate", null, 7, false],
      ["noEstimateFar", "needsEstimate", null, null, true],
      ["upcoming", "upcoming", { start: 7, end: 7, clippedStart: false, clippedEnd: false }, 8, false],
    ]);
  });

  it("日数が不正ならエラー", () => {
    expect(() => timeline([], 0)).toThrow(RangeError);
  });
});
