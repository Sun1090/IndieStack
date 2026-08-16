/**
 * 工具函数单元测试
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cn, formatNumber, generateId, absoluteUrl } from "./utils";

describe("cn()", () => {
  it("should merge class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("should handle conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("should resolve Tailwind conflicts", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("should handle empty input", () => {
    expect(cn()).toBe("");
  });

  it("should handle null and undefined", () => {
    expect(cn("base", null, undefined, "end")).toBe("base end");
  });
});

describe("formatNumber()", () => {
  it("should format numbers with locale separators", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("should format small numbers", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
  });

  it("should format negative numbers", () => {
    expect(formatNumber(-500)).toBe("-500");
  });
});

describe("generateId()", () => {
  it("should generate a UUID v4 string", () => {
    const id = generateId();
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("absoluteUrl()", () => {
  const prev = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prev;
  });

  it("配置了 APP_URL 时拼接前缀", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(absoluteUrl("/dashboard")).toBe("https://app.example.com/dashboard");
  });

  it("路径缺省前导斜杠时自动补全", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    expect(absoluteUrl("dashboard")).toBe("https://app.example.com/dashboard");
  });

  it("未配置时回退到 localhost:3000", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(absoluteUrl("/team")).toBe("http://localhost:3000/team");
  });
});

describe("generateId() 回退", () => {
  it("crypto 不可用时回退到时间戳 ID", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const id = generateId();
      expect(id).toMatch(/^\d+-[a-z0-9]{8}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
