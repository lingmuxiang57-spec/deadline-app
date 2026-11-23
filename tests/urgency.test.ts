import { describe, expect, it } from "vitest";
import { daysBehind, dueBadgeLabel, urgencyOf } from "@/lib/urgency";

const now = new Date("2026-11-23T10:00:00+09:00");
const jst = (s: string) => new Date(`${s}:00+09:00`);

describe("urgencyOf", () => {
  it("締切を過ぎたら overdue（今日の朝が締切でも）", () => {
    expect(urgencyOf({ deadline: jst("2026-11-23T09:00"), now })).toBe("overdue");
    expect(urgencyOf({ deadline: jst("2026-11-20T23:59"), now })).toBe("overdue");
  });
  it("締切が今日（この後）か明日なら dueSoon", () => {
    expect(urgencyOf({ deadline: jst("2026-11-23T23:59"), now })).toBe("dueSoon");
    expect(urgencyOf({ deadline: jst("2026-11-24T23:59"), now })).toBe("dueSoon");
  });
  it("締切はまだ先でも、着手すべき日を過ぎていれば behind", () => {
    expect(urgencyOf({ deadline: jst("2026-11-30T23:59"), now, startBy: "2026-11-22" })).toBe("behind");
  });
  it("着手すべき日が今日ならまだ遅れていない", () => {
    expect(urgencyOf({ deadline: jst("2026-11-30T23:59"), now, startBy: "2026-11-23" })).toBe("normal");
  });
  it("締切が近いことは着手の遅れより優先する", () => {
    expect(urgencyOf({ deadline: jst("2026-11-24T12:00"), now, startBy: "2026-11-20" })).toBe("dueSoon");
  });
});

describe("dueBadgeLabel", () => {
  it.each([
    ["2026-11-23T09:00", "締切超過"],
    ["2026-11-23T23:59", "今日まで"],
    ["2026-11-24T10:00", "明日まで"],
    ["2026-11-28T23:59", "あと5日"],
  ])("%s → %s", (deadline, label) => {
    expect(dueBadgeLabel(jst(deadline), now)).toBe(label);
  });
});

describe("daysBehind", () => {
  it("着手すべき日から何日遅れているか", () => {
    expect(daysBehind("2026-11-21", "2026-11-23")).toBe(2);
    expect(daysBehind("2026-11-23", "2026-11-23")).toBe(0);
    expect(daysBehind("2026-11-25", "2026-11-23")).toBe(0);
  });
});
