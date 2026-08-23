import { describe, it, expect, vi } from "vitest";
import { features } from "./feature-flags";

describe("feature-flags", () => {
  it("导出已知的功能开关集合", () => {
    expect(Object.keys(features).sort()).toEqual(["auditLogExport", "avatarUpload", "webhookDebugPage"]);
  });

  it("开关值为布尔类型", () => {
    for (const value of Object.values(features)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("环境变量 true 解析为开启", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_WEBHOOK_DEBUG_PAGE", "true");
    vi.resetModules();
    const { features: refreshed } = await import("./feature-flags");
    expect(refreshed.webhookDebugPage).toBe(true);
    vi.unstubAllEnvs();
  });

  it("未设置时使用默认值", async () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_AVATAR_UPLOAD", "");
    vi.resetModules();
    const { features: refreshed } = await import("./feature-flags");
    expect(refreshed.avatarUpload).toBe(false);
    vi.unstubAllEnvs();
  });
});
