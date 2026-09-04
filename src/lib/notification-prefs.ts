/**
 * 通知偏好联动矩阵（D03）
 * 规则：
 * - 站内通知中心：全量展示，偏好不影响。
 * - 邮件发送：总开关 emailNotifications 关闭则一律不发；开启后按类型映射到细分开关。
 * - marketingEmails 为独立营销通道，不经过 notifications 表。
 */
import type { NotificationType } from "@/lib/repositories/notifications";

export interface EmailPreferences {
  emailNotifications?: boolean;
  marketingEmails?: boolean;
  productUpdates?: boolean;
  securityAlerts?: boolean;
}

/** 类型 → 细分偏好键（emailNotifications 为总开关，另行判断） */
export const TYPE_PREFERENCE_MAP: Record<NotificationType, keyof EmailPreferences> = {
  system: "emailNotifications",
  team_invite: "emailNotifications",
  role_changed: "emailNotifications",
  payment_succeeded: "emailNotifications",
  billing_update: "emailNotifications",
  deployment: "productUpdates",
  security_alert: "securityAlerts",
};

/** 该类型是否允许发邮件（默认开：缺字段视为 true，与表单默认值一致） */
export function shouldSendEmail(
  prefs: EmailPreferences,
  type: NotificationType,
): boolean {
  if (prefs.emailNotifications === false) return false;
  const key = TYPE_PREFERENCE_MAP[type];
  return prefs[key] !== false;
}
