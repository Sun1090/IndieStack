/**
 * 日期工具函数单元测试
 * 注意：使用本地时区构造日期，避免环境时区差异导致断言不稳定
 */
import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatRelativeTime,
  formatDateRange,
  getFriendlyDate,
  toLocalISOString,
  isToday,
  isYesterday,
  isThisWeek,
} from "./date";

/** 构造本地时区的固定日期（2026-07-19 10:30:00） */
function fixedDate(): Date {
  return new Date(2026, 6, 19, 10, 30, 0);
}

describe("formatDate()", () => {
  it("默认输出 yyyy-MM-dd", () => {
    expect(formatDate(fixedDate())).toBe("2026-07-19");
  });

  it("支持自定义 pattern", () => {
    expect(formatDate(fixedDate(), { pattern: "yyyy年M月d日" })).toBe("2026年7月19日");
  });

  it("接受字符串与时间戳输入", () => {
    const ts = fixedDate().getTime();
    expect(formatDate(ts)).toBe("2026-07-19");
    expect(formatDate(new Date(2026, 0, 2).toISOString())).toBe("2026-01-02");
  });

  it("无效日期返回 Invalid date", () => {
    expect(formatDate("not-a-date")).toBe("Invalid date");
    expect(formatDate(new Date(NaN))).toBe("Invalid date");
  });
});

describe("formatRelativeTime()", () => {
  it("10 秒内：默认英文显示 just now / soon", () => {
    expect(formatRelativeTime(Date.now() - 5_000)).toBe("just now");
    expect(formatRelativeTime(Date.now() + 5_000)).toBe("soon");
  });

  it("10 秒内：zh-CN 显示 刚刚 / 马上", () => {
    expect(formatRelativeTime(Date.now() - 5_000, { locale: "zh-CN" })).toBe("刚刚");
    expect(formatRelativeTime(Date.now() + 5_000, { locale: "zh-CN" })).toBe("马上");
  });

  it("更早的过去时间：默认英文包含 ago", () => {
    const result = formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000);
    expect(result).toContain("ago");
  });

  it("更早的过去时间：zh-CN 包含 前", () => {
    const result = formatRelativeTime(Date.now() - 3 * 60 * 60 * 1000, { locale: "zh-CN" });
    expect(result).toContain("前");
  });

  it("无效日期返回 Invalid date", () => {
    expect(formatRelativeTime("bad-date")).toBe("Invalid date");
  });
});

describe("formatDateRange()", () => {
  it("同日只显示单个日期", () => {
    expect(formatDateRange(new Date(2026, 6, 19), new Date(2026, 6, 19))).toBe("2026-07-19");
  });

  it("跨日显示 start ~ end", () => {
    expect(formatDateRange(new Date(2026, 0, 1), new Date(2026, 0, 31))).toBe(
      "2026-01-01 ~ 2026-01-31",
    );
  });

  it("无效日期返回 Invalid date range", () => {
    expect(formatDateRange("bad", new Date())).toBe("Invalid date range");
    expect(formatDateRange(new Date(), "bad")).toBe("Invalid date range");
  });
});

describe("getFriendlyDate()", () => {
  it("今天显示 今天 HH:mm", () => {
    const now = new Date();
    expect(getFriendlyDate(now)).toBe(
      `今天 ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`,
    );
  });

  it("昨天显示 昨天 HH:mm", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = getFriendlyDate(yesterday);
    expect(result).toMatch(/^昨天 \d{2}:\d{2}$/);
  });

  it("同年非今昨显示 M月d日", () => {
    const thisYear = new Date().getFullYear();
    expect(getFriendlyDate(new Date(thisYear, 5, 15))).toBe("6月15日");
  });

  it("往年显示 yyyy年M月d日", () => {
    const lastYear = new Date().getFullYear() - 1;
    expect(getFriendlyDate(new Date(lastYear, 5, 15))).toBe(`${lastYear}年6月15日`);
  });

  it("无效日期返回 Invalid date", () => {
    expect(getFriendlyDate("bad")).toBe("Invalid date");
  });
});

describe("toLocalISOString()", () => {
  it("输出本地时区 yyyy-MM-ddTHH:mm:ss", () => {
    expect(toLocalISOString(new Date(2026, 0, 15, 12, 30, 45))).toBe("2026-01-15T12:30:45");
  });

  it("默认参数为当前时间", () => {
    const now = new Date();
    expect(toLocalISOString()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
    );
  });
});

describe("date-fns 再导出", () => {
  it("isToday / isYesterday / isThisWeek 可用", () => {
    expect(isToday(new Date())).toBe(true);
    expect(isYesterday(new Date(Date.now() - 24 * 60 * 60 * 1000))).toBe(true);
    expect(isThisWeek(new Date())).toBe(true);
  });
});
