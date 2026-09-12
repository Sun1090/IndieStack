/** XHR 上传客户端 DOM 测试：进度、响应解析、网络失败与取消。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUploadRequest } from "./client";

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest;
  status = 0;
  response: unknown = null;
  responseType = "";
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sent: FormData | null = null;
  aborted = false;

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open = vi.fn();
  send(body: FormData) {
    this.sent = body;
  }
  abort = vi.fn(() => {
    this.aborted = true;
    this.onabort?.();
  });
}

afterEach(() => vi.unstubAllGlobals());

function request(file = new File(["image"], "a.png", { type: "image/png" }), onProgress?: (value: number) => void) {
  return createUploadRequest({
    url: "/api/uploads/avatar",
    fieldName: "avatar",
    fields: { projectId: "p1" },
    file,
    onProgress,
  });
}

describe("createUploadRequest", () => {
  it("发送 multipart、截断进度并解析成功响应", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const progress = vi.fn();
    const handle = request(undefined, progress);
    const xhr = FakeXMLHttpRequest.latest;

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 51, total: 100 } as ProgressEvent);
    xhr.status = 201;
    xhr.response = { ok: true, data: { url: "https://cdn.example/a.png" } };
    xhr.onload?.();

    await expect(handle.promise).resolves.toEqual({ ok: true, data: { url: "https://cdn.example/a.png" } });
    expect(progress).toHaveBeenCalledWith(51);
    expect(xhr.sent?.get("projectId")).toBe("p1");
    expect(xhr.sent?.get("avatar")).toBeInstanceOf(File);
  });

  it("无法计算进度时不上报", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const progress = vi.fn();
    const handle = request(undefined, progress);
    FakeXMLHttpRequest.latest.upload.onprogress?.({ lengthComputable: false } as ProgressEvent);
    FakeXMLHttpRequest.latest.status = 200;
    FakeXMLHttpRequest.latest.response = { ok: true, data: { url: "u" } };
    FakeXMLHttpRequest.latest.onload?.();
    await handle.promise;
    expect(progress).not.toHaveBeenCalled();
  });

  it("解析服务端错误与非 JSON 响应", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const rateLimited = request();
    FakeXMLHttpRequest.latest.status = 429;
    FakeXMLHttpRequest.latest.response = { ok: false, error: "rateLimited" };
    FakeXMLHttpRequest.latest.onload?.();
    await expect(rateLimited.promise).resolves.toEqual({ ok: false, error: "rateLimited" });

    const malformed = request();
    FakeXMLHttpRequest.latest.status = 500;
    FakeXMLHttpRequest.latest.response = null;
    FakeXMLHttpRequest.latest.onload?.();
    await expect(malformed.promise).resolves.toEqual({ ok: false, error: "uploadFailed" });
  });

  it("网络错误返回 uploadFailed", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const handle = request();
    FakeXMLHttpRequest.latest.onerror?.();
    await expect(handle.promise).resolves.toEqual({ ok: false, error: "uploadFailed" });
  });

  it("取消返回 uploadCancelled 且仅结算一次", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const handle = request();
    const xhr = FakeXMLHttpRequest.latest;
    handle.cancel();
    xhr.status = 200;
    xhr.response = { ok: true, data: { url: "late" } };
    xhr.onload?.();
    await expect(handle.promise).resolves.toEqual({ ok: false, error: "uploadCancelled" });
    expect(xhr.aborted).toBe(true);

    handle.cancel();
    expect(xhr.abort).toHaveBeenCalledTimes(1);
  });

  it("send 同步抛错时安全失败", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const send = vi.spyOn(FakeXMLHttpRequest.prototype, "send").mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    const handle = request();
    await expect(handle.promise).resolves.toEqual({ ok: false, error: "uploadFailed" });
    send.mockRestore();
  });
});
