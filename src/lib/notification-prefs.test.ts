/**
 * 通知偏好联动矩阵单测（D03 测试职责）
 */
import { describe, it, expect } from "vitest";
import { shouldSendEmail, TYPE_PREFERENCE_MAP } from "./notification-prefs";
import { NOTIFICATION_TYPES } from "./repositories/notifications";

describe("TYPE_PREFERENCE_MAP", () => {
  it("覆盖全部通知类型", () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(TYPE_PREFERENCE_MAP[t]).toBeDefined();
    }
  });
});

describe("shouldSendEmail()", () => {
  it("总开关关闭一律不发", () => {
    expect(
      shouldSendEmail({ emailNotifications: false, securityAlerts: true }, "security_alert"),
    ).toBe(false);
  });

  it("安全告警走 securityAlerts", () => {
    expect(shouldSendEmail({ securityAlerts: true }, "security_alert")).toBe(true);
    expect(shouldSendEmail({ securityAlerts: false }, "security_alert")).toBe(false);
  });

  it("部署走 productUpdates", () => {
    expect(shouldSendEmail({}, "deployment")).toBe(true);
    expect(shouldSendEmail({ productUpdates: false }, "deployment")).toBe(false);
  });

  it("缺字段默认开启（与表单默认值一致）", () => {
    expect(shouldSendEmail({}, "team_invite")).toBe(true);
    expect(shouldSendEmail({}, "system")).toBe(true);
  });
});
