/** 上传请求边界单测：同源、限流、体积、multipart 与错误状态。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { rateLimitCheck } = vi.hoisted(() => ({ rateLimitCheck: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: { check: rateLimitCheck } }));

import { MAX_UPLOAD_BODY_BYTES, guardUploadRequest, uploadErrorStatus, uploadResultResponse } from "./request";

function request(headers: Record<string, string> = {}, url = "https://indiestack.test/api/uploads/avatar") {
  return new NextRequest(url, { method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitCheck.mockResolvedValue({ allowed: true, resetIn: 0 });
});

describe("guardUploadRequest", () => {
  it("缺少或跨站 Origin 返回 403", async () => {
    for (const candidate of [request(), request({ origin: "https://evil.test" }), request({ origin: "not-a-url" })]) {
      const result = await guardUploadRequest(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
    expect(rateLimitCheck).not.toHaveBeenCalled();
  });

  it("限流返回 429 与 Retry-After", async () => {
    rateLimitCheck.mockResolvedValueOnce({ allowed: false, resetIn: 2500 });
    const result = await guardUploadRequest(
      request({ origin: "https://indiestack.test" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(429);
      expect(result.response.headers.get("retry-after")).toBe("3");
      await expect(result.response.json()).resolves.toMatchObject({ error: "rateLimited", retryAfter: 3 });
    }
  });

  it("声明请求体超限返回 413", async () => {
    const result = await guardUploadRequest(
      request({
        origin: "https://indiestack.test",
        "content-length": String(MAX_UPLOAD_BODY_BYTES + 1),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("**没有 Content-Length 就拒绝（411），不把 body 读进内存**", async () => {
    // 这条钉的是一个真实的可绕过：`Number(null)` 是 0，`Number.isFinite(0)` 为真、
    // 0 也不大于上限 ⇒ 缺头时那道守卫**静默放行**，紧接着 `formData()` 把整个 body
    // 读进内存。触发方式是 `Transfer-Encoding: chunked` 的 multipart POST，
    // 而 Origin 由调用方自填（这道检查挡浏览器跨站，不挡 curl）。
    // Vercel 有 4.5MB 平台上限，仓库自带 Dockerfile 的自托管构型没有。
    const cases: Record<string, string>[] = [
      { origin: "https://indiestack.test" }, // 完全没有这个头
      { origin: "https://indiestack.test", "content-length": "" }, // 空串：Number("") 也是 0
      { origin: "https://indiestack.test", "content-length": "abc" }, // 解析不出来
      { origin: "https://indiestack.test", "content-length": "-5" }, // 负数
    ];
    for (const headers of cases) {
      const candidate = request(headers);
      // 关键断言：**body 一次都没有被读**。只断言状态码会让「读完了才发现没长度」也变绿。
      candidate.formData = vi.fn().mockResolvedValue(new FormData());
      const result = await guardUploadRequest(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(411);
        await expect(result.response.json()).resolves.toMatchObject({ error: "lengthRequired" });
      }
      expect(candidate.formData).not.toHaveBeenCalled();
    }
  });

  it("合法 multipart 返回 400", async () => {
    const candidate = request({ origin: "https://indiestack.test", "content-length": "64" });
    candidate.formData = vi.fn().mockRejectedValue(new Error("bad multipart"));
    const result = await guardUploadRequest(candidate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });

  it("合法同源请求返回 FormData", async () => {
    const candidate = request({ origin: "https://indiestack.test", "content-length": "64" });
    candidate.formData = vi.fn().mockResolvedValue(new FormData());
    const result = await guardUploadRequest(candidate);
    expect(result.ok).toBe(true);
  });
});

describe("错误映射", () => {
  it.each([
    ["notAuthenticated", 401],
    ["forbidden", 403],
    ["projectNotFound", 404],
    ["fileTooLarge", 413],
    // 缺 Content-Length 是 411 而不是 413：调用方看到 413 会去查自己的文件大小
    ["lengthRequired", 411],
    ["rateLimited", 429],
    ["uploadCancelled", 408],
    ["uploadFailed", 500],
    // 读不到授权判定所需的那一行：可重试，不是「服务器坏了」也不是「没权限」
    ["uploadUnavailable", 503],
    ["unknown", 500],
  ])("%s -> %i", (error, status) => {
    expect(uploadErrorStatus(error)).toBe(status);
  });

  it("成功和失败响应都为 no-store", async () => {
    const success = uploadResultResponse({ ok: true, data: { url: "u" } });
    const failure = uploadResultResponse({ ok: false, error: "fileRequired" });
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(failure.headers.get("cache-control")).toBe("no-store");
    expect(failure.status).toBe(400);
  });
});
