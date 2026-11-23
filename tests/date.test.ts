import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  isValidDate,
  isValidTimeZone,
  jstDateTime,
  toDateKey,
  zonedTimeToDate,
} from "@/lib/date";

describe("toDateKey（日本時間での日付判定）", () => {
  it("UTC では前日でも、日本時間の日付で数える", () => {
    // 2026-12-04T15:30Z = 12/5 00:30 JST
    expect(toDateKey(new Date("2026-12-04T15:30:00Z"))).toBe("2026-12-05");
  });
  it("日本時間 23:59 はその日のまま", () => {
    expect(toDateKey(new Date("2026-12-05T23:59:00+09:00"))).toBe("2026-12-05");
  });
  it("不正な日時はエラー", () => {
    expect(() => toDateKey(new Date("invalid"))).toThrow(RangeError);
  });
});

describe("addDays / diffDays", () => {
  it("月をまたぐ", () => {
    expect(addDays("2026-12-01", -1)).toBe("2026-11-30");
  });
  it("年をまたぐ", () => {
    expect(addDays("2027-01-02", -7)).toBe("2026-12-26");
  });
  it("うるう日を扱う", () => {
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("形式が不正ならエラー", () => {
    expect(() => addDays("2026/12/01", 1)).toThrow(RangeError);
  });
  it("日数の差", () => {
    expect(diffDays("2026-12-20", "2027-01-10")).toBe(21);
    expect(diffDays("2027-01-10", "2026-12-20")).toBe(-21);
  });
});

describe("isValidDate", () => {
  it.each([
    [2026, 12, 5, true],
    [2026, 2, 29, false],
    [2028, 2, 29, true],
    [2026, 2, 30, false],
    [2026, 13, 1, false],
    [2026, 0, 1, false],
  ])("%i/%i/%i → %s", (y, m, d, expected) => {
    expect(isValidDate(y, m, d)).toBe(expected);
  });
});

describe("zonedTimeToDate / jstDateTime", () => {
  it("日本時間の壁時計の時刻を Date にする", () => {
    expect(zonedTimeToDate({ year: 2026, month: 12, day: 5, hour: 9, minute: 0 }).toISOString()).toBe(
      "2026-12-05T00:00:00.000Z",
    );
  });
  it("他のタイムゾーンも扱う（ニューヨークの冬時間は UTC−5）", () => {
    expect(
      zonedTimeToDate(
        { year: 2026, month: 12, day: 5, hour: 9, minute: 0 },
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-12-05T14:00:00.000Z");
  });
  it("夏時間も扱う（ニューヨークの夏時間は UTC−4）", () => {
    expect(
      zonedTimeToDate({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, "America/New_York").toISOString(),
    ).toBe("2026-07-01T13:00:00.000Z");
  });
  it("時刻を省くとその日の 23:59（日本時間）", () => {
    expect(jstDateTime("2026-12-05").toISOString()).toBe("2026-12-05T14:59:00.000Z");
  });
  it("時刻を指定できる", () => {
    expect(jstDateTime("2026-12-05", { hour: 10, minute: 30 }).toISOString()).toBe(
      "2026-12-05T01:30:00.000Z",
    );
  });
});

describe("isValidTimeZone", () => {
  it("IANA のタイムゾーン名なら true", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
  });
  it("存在しない名前なら false", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
