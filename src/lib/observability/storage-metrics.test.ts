/**
 * 存储 / 上传指标契约单测（v0.6.0 E05）
 * 覆盖：指标名与维度、outcome 取值集合、终态映射、计时器只上报一次。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { metricEvents } from "@/lib/testing/metric-events";
import {
  STORAGE_PROVIDERS,
  STORAGE_UPLOAD_METRIC,
  STORAGE_UPLOAD_OUTCOMES,
  UPLOAD_OPERATIONS,
  UPLOAD_OUTCOMES,
  UPLOAD_REQUEST_METRIC,
  storageUploadTimer,
  uploadRequestTimer,
} from "./storage-metrics";
import { uploadOutcomeFor } from "@/lib/uploads/service";

afterEach(() => vi.restoreAllMocks());

describe("指标契约常量", () => {
  it("指标名稳定：改名即意味着仪表盘与告警规则同步失效", () => {
    expect(STORAGE_UPLOAD_METRIC).toBe("storage.upload.completed");
    expect(UPLOAD_REQUEST_METRIC).toBe("upload.request.completed");
  });

  it("provider 与 operation 集合与实现一致", () => {
    expect(STORAGE_PROVIDERS).toEqual(["supabase", "oss"]);
    expect(UPLOAD_OPERATIONS).toEqual(["avatar-upload", "project-cover-upload"]);
  });

  it("取消单列在 provider 层之外，避免计入失败率分子", () => {
    expect(STORAGE_UPLOAD_OUTCOMES).toEqual(["success", "failure"]);
    expect(UPLOAD_OUTCOMES).toEqual(["success", "failure", "cancelled"]);
  });
});

describe("storageUploadTimer()", () => {
  it("成功时上报 provider + outcome=success，单位为毫秒", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    storageUploadTimer("oss").end("success");
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "storage.upload.completed",
        unit: "ms",
        attributes: { provider: "oss", outcome: "success" },
      }),
    ]);
  });

  it("失败时保持同一指标名，只按 outcome 维度区分", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    storageUploadTimer("supabase").end("failure");
    expect(metricEvents(log)).toEqual([
      expect.objectContaining({
        name: "storage.upload.completed",
        attributes: { provider: "supabase", outcome: "failure" },
      }),
    ]);
  });
});

describe("uploadRequestTimer()", () => {
  it("上报 operation 与 outcome，并只上报一次", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const timer = uploadRequestTimer("avatar-upload");
    timer.end("success");
    timer.end("failure");
    expect(metricEvents(log)).toHaveLength(1);
    expect(metricEvents(log)[0]).toEqual(
      expect.objectContaining({
        name: "upload.request.completed",
        unit: "ms",
        attributes: { operation: "avatar-upload", outcome: "success" },
      }),
    );
  });
});

describe("uploadOutcomeFor()", () => {
  it("成功、取消与失败映射到三个互不重叠的终态", () => {
    expect(uploadOutcomeFor({ ok: true, data: { url: "https://cdn.example/k.png" } })).toBe(
      "success",
    );
    expect(uploadOutcomeFor({ ok: false, error: "uploadCancelled" })).toBe("cancelled");
    expect(uploadOutcomeFor({ ok: false, error: "uploadFailed" })).toBe("failure");
    expect(uploadOutcomeFor({ ok: false, error: "fileTooLarge" })).toBe("failure");
  });
});
