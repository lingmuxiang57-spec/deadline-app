import { describe, expect, it } from "vitest";
import { parseDeadlineInput, toDeadlineInputValues } from "@/lib/deadlineInput";

describe("parseDeadlineInput", () => {
  it("日付と時刻（日本時間）", () => {
    expect(parseDeadlineInput("2026-12-05", "09:30")?.toISOString()).toBe("2026-12-05T00:30:00.000Z");
  });
  it("時刻が空ならその日の 23:59", () => {
    expect(parseDeadlineInput("2026-12-05", "")?.toISOString()).toBe("2026-12-05T14:59:00.000Z");
    expect(parseDeadlineInput("2026-12-05", null)?.toISOString()).toBe("2026-12-05T14:59:00.000Z");
  });
  it.each([
    ["", ""],
    ["2026/12/05", ""],
    ["2026-02-30", ""],
    ["2026-12-05", "24:00"],
    ["2026-12-05", "9:30"],
    ["2026-12-05", "09:60"],
    [null, "09:00"],
  ])("不正な入力（%s, %s）は null", (date, time) => {
    expect(parseDeadlineInput(date, time)).toBeNull();
  });
});

describe("toDeadlineInputValues", () => {
  it("日本時間の日付と時刻", () => {
    expect(toDeadlineInputValues(new Date("2026-12-03T07:00:00Z"))).toEqual({ date: "2026-12-03", time: "16:00" });
  });
  it("23:59 は時刻なし", () => {
    expect(toDeadlineInputValues(new Date("2026-12-05T14:59:00Z"))).toEqual({ date: "2026-12-05", time: "" });
  });
  it("入力欄の値に戻すと元の日時になる", () => {
    const deadline = new Date("2026-12-03T07:00:00Z");
    const { date, time } = toDeadlineInputValues(deadline);
    expect(parseDeadlineInput(date, time)).toEqual(deadline);
  });
});
