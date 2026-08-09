/**
 * 工具函数单元测试
 */
import { describe, it, expect } from "vitest";
import { cn, formatNumber, generateId } from "./utils";

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