import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "@/lib/parseQuickAdd";

const now = new Date("2026-11-23T10:00:00+09:00");

/** 成功したときの件名・締切日・締切（日本時間の ISO 表記）を取り出す */
function parsed(input: string, at: Date = now) {
  const result = parseQuickAdd(input, at);
  if (!result.ok) throw new Error(`失敗: ${result.error}`);
  return {
    title: result.title,
    date: result.deadlineDate,
    hasTime: result.hasTime,
    jst: new Date(result.deadline.getTime() + 9 * 3600_000).toISOString().slice(0, 16),
  };
}

const errorOf = (input: string, at: Date = now) => {
  const result = parseQuickAdd(input, at);
  return result.ok ? null : result.error;
};

describe("README の例", () => {
  it("「ゼミ発表資料 12/5」→ 件名と締切（時刻なしは 23:59）", () => {
    expect(parsed("ゼミ発表資料 12/5")).toEqual({
      title: "ゼミ発表資料",
      date: "2026-12-05",
      hasTime: false,
      jst: "2026-12-05T23:59",
    });
  });
});

describe("日付の書き方", () => {
  it.each([
    ["レポート 12/5", "2026-12-05"],
    ["レポート 12月5日", "2026-12-05"],
    ["レポート 12月5", "2026-12-05"],
    ["レポート 2027/1/8", "2027-01-08"],
    ["レポート 2027年1月8日", "2027-01-08"],
    ["レポート 12/5(金)", "2026-12-05"],
    ["レポート 12/5（金曜）", "2026-12-05"],
    ["レポート 12/5 (金曜日)", "2026-12-05"],
    ["レポート 今日", "2026-11-23"],
    ["レポート 明日", "2026-11-24"],
    ["レポート あさって", "2026-11-25"],
  ])("%s → %s", (input, date) => {
    expect(parsed(input)).toMatchObject({ title: "レポート", date });
  });

  it("全角の数字・記号・空白も受け付ける", () => {
    expect(parsed("レポート　１２／５")).toMatchObject({ title: "レポート", date: "2026-12-05" });
  });

  it("日付を先頭に書いてもよい", () => {
    expect(parsed("12/5 ゼミ発表資料")).toMatchObject({ title: "ゼミ発表資料", date: "2026-12-05" });
  });

  it("空白なしで件名に続けてもよい", () => {
    expect(parsed("ゼミ発表資料12/5")).toMatchObject({ title: "ゼミ発表資料", date: "2026-12-05" });
  });

  it("件名の中の数字は件名に残す", () => {
    expect(parsed("第3回レポート 12/5")).toMatchObject({ title: "第3回レポート", date: "2026-12-05" });
    expect(parsed("課題2 12/5")).toMatchObject({ title: "課題2", date: "2026-12-05" });
  });

  it("日付の前の区切り記号は件名から外す", () => {
    expect(parsed("ゼミ発表資料：12/5")).toMatchObject({ title: "ゼミ発表資料" });
    expect(parsed("ゼミ発表資料 - 12/5")).toMatchObject({ title: "ゼミ発表資料" });
  });

  it("件名末尾の長音は消さない", () => {
    expect(parsed("資料のコピー 12/5")).toMatchObject({ title: "資料のコピー" });
  });
});

describe("時刻の書き方", () => {
  it.each([
    ["ES提出 12/5 9:00", "2026-12-05T09:00"],
    ["ES提出 12/5 18:30", "2026-12-05T18:30"],
    ["ES提出 12/5 9時", "2026-12-05T09:00"],
    ["ES提出 12/5 9時半", "2026-12-05T09:30"],
    ["ES提出 12/5 9時15分", "2026-12-05T09:15"],
    ["ES提出 12/5(金) 12:00", "2026-12-05T12:00"],
    ["ES提出 明日 10:00", "2026-11-24T10:00"],
    ["ES提出 12/5 ９：００", "2026-12-05T09:00"],
  ])("%s → %s", (input, jst) => {
    expect(parsed(input)).toMatchObject({ title: "ES提出", hasTime: true, jst });
  });

  it("「24:00」は日付を変えずにその日の 23:59", () => {
    expect(parsed("課題 12/5 24:00")).toMatchObject({ date: "2026-12-05", jst: "2026-12-05T23:59" });
  });

  it.each(["課題 12/5 25:00", "課題 12/5 9:60", "課題 12/5 24:30"])("%s は時刻エラー", (input) => {
    expect(errorOf(input)).toBe("invalidTime");
  });
});

describe("年の補い方（今日に最も近い年）", () => {
  it("年末に翌年1月の日付を入れたら翌年", () => {
    expect(parsed("課題 1/10", new Date("2026-12-20T10:00:00+09:00")).date).toBe("2027-01-10");
  });
  it("年明けに前年12月の日付を入れたら前年（締切を過ぎたものの記録）", () => {
    expect(parsed("課題 12/28", new Date("2027-01-03T10:00:00+09:00")).date).toBe("2026-12-28");
  });
  it("昨日の日付は翌年ではなく今年", () => {
    expect(parsed("課題 11/22").date).toBe("2026-11-22");
  });
  it("「今日」は日本時間で判定する（UTC では前日の 23:30 でも、日本時間の 11/24）", () => {
    expect(parsed("課題 今日", new Date("2026-11-23T15:30:00Z")).date).toBe("2026-11-24");
  });
  it("2/29 は存在する年を選ぶ", () => {
    expect(parsed("課題 2/29", new Date("2027-12-01T10:00:00+09:00")).date).toBe("2028-02-29");
  });
});

describe("エラー", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["ゼミ発表資料", "noDate"],
    ["ゼミ 12/5 発表資料", "noDate"],
    ["課題 2/30", "invalidDate"],
    ["課題 13/1", "invalidDate"],
    ["課題 2026/2/29", "invalidDate"],
    ["12/5", "noTitle"],
    ["：12/5", "noTitle"],
  ])("「%s」→ %s", (input, error) => {
    expect(errorOf(input)).toBe(error);
  });

  it("数字が続いて区切りが曖昧なら日付とみなさない（「第1 12/5」か「第11 2/5」か決められない）", () => {
    expect(errorOf("第112/5")).toBe("noDate");
  });
});
