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

describe("isSafeRelativePath 边界", () => {
  it("无效百分号编码应拒绝（decodeURIComponent 抛错）", () => {
    expect(isSafeRelativePath("/%")).toBe(false);
    expect(isSafeRelativePath("/%zz")).toBe(false);
  });
});

describe("isSafeRelativePath 开放重定向 fuzz", () => {
  const malicious = [
    "//evil.com",
    "/\\evil.com",
    "/%5C%5Cevil.com",
    "/%2F%2Fevil.com",
    "/\\\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\r\nSet-Cookie: x",
    "/%0d%0aX-Header: 1",
    "/\u0000",
  ];

  it.each(malicious)("拒绝恶意路径 %s", (path) => {
    expect(isSafeRelativePath(path)).toBe(false);
  });

  const legit = ["/", "/dashboard", "/dashboard/team?tab=x", "/blog/hello-world", "/%E4%B8%AD%E6%96%87",
    "/x?next=//evil.com"];
  it.each(legit)("放行正常路径 %s", (path) => {
    expect(isSafeRelativePath(path)).toBe(true);
  });
});
