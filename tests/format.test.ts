import { describe, expect, it } from "vitest";
import { formatDateLabel, formatDeadline, formatEstimate, formatRelativeDay } from "@/lib/format";

describe("formatDateLabel", () => {
  it("月/日(曜日)", () => {
    expect(formatDateLabel("2026-12-05")).toBe("12/5(土)");
    expect(formatDateLabel("2027-01-03")).toBe("1/3(日)");
  });
});

describe("formatDeadline", () => {
  it("時刻があれば付ける（日本時間）", () => {
    expect(formatDeadline(new Date("2026-12-05T00:00:00Z"))).toBe("12/5(土) 9:00");
    expect(formatDeadline(new Date("2026-12-05T09:30:00Z"))).toBe("12/5(土) 18:30");
  });
  it("23:59 はその日中なので時刻を省く", () => {
    expect(formatDeadline(new Date("2026-12-05T23:59:00+09:00"))).toBe("12/5(土)");
  });
});

describe("formatRelativeDay", () => {
  it.each([
    ["2026-11-23", "今日"],
    ["2026-11-24", "明日"],
    ["2026-11-25", "あさって"],
    ["2026-11-28", "あと5日"],
    ["2026-11-22", "昨日"],
    ["2026-11-20", "3日前"],
  ])("%s → %s", (target, label) => {
    expect(formatRelativeDay("2026-11-23", target)).toBe(label);
  });
});

describe("formatEstimate", () => {
  it("選択肢にあればそのラベル", () => {
    expect(formatEstimate(30)).toBe("30分");
    expect(formatEstimate(240)).toBe("半日");
    expect(formatEstimate(3360)).toBe("1週間");
  });
  it("選択肢になければ時間・分", () => {
    expect(formatEstimate(45)).toBe("45分");
    expect(formatEstimate(180)).toBe("3時間");
    expect(formatEstimate(90)).toBe("1時間30分");
  });
});
