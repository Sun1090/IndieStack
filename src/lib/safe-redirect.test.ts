/**
 * 安全重定向工具测试
 */
import { describe, it, expect } from "vitest";
import { isSafeRelativePath, getSafeRedirect } from "./safe-redirect";

describe("isSafeRelativePath", () => {
  it("应接受站内相对路径", () => {
    expect(isSafeRelativePath("/dashboard")).toBe(true);
    expect(isSafeRelativePath("/dashboard/team")).toBe(true);
    expect(isSafeRelativePath("/")).toBe(true);
  });

  it("应拒绝绝对 URL", () => {
    expect(isSafeRelativePath("https://evil.com")).toBe(false);
    expect(isSafeRelativePath("http://evil.com")).toBe(false);
  });

  it("应拒绝协议相对 URL", () => {
    expect(isSafeRelativePath("//evil.com")).toBe(false);
    expect(isSafeRelativePath("/\\evil.com")).toBe(false);
    expect(isSafeRelativePath("/%5c%5cevil.com")).toBe(false);
  });

  it("应拒绝其他协议", () => {
    expect(isSafeRelativePath("javascript:alert(1)")).toBe(false);
    expect(isSafeRelativePath("data:text/html,<script>")).toBe(false);
  });

  it("应拒绝含控制字符的路径", () => {
    expect(isSafeRelativePath("/dashboard\r\nSet-Cookie: x")).toBe(false);
  });
});

describe("getSafeRedirect", () => {
  const fallback = "/dashboard";

  it("合法值原样返回", () => {
    expect(getSafeRedirect("/team", fallback)).toBe("/team");
  });

  it("非法值回退到 fallback", () => {
    expect(getSafeRedirect("https://evil.com", fallback)).toBe(fallback);
    expect(getSafeRedirect("//evil.com", fallback)).toBe(fallback);
  });

  it("null / undefined 回退到 fallback", () => {
    expect(getSafeRedirect(null, fallback)).toBe(fallback);
    expect(getSafeRedirect(undefined, fallback)).toBe(fallback);
  });
});
