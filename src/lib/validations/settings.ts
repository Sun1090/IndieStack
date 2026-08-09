/**
 * 设置表单验证规则
 * 使用 Zod 定义通知偏好等设置表单的校验规则
 */
import { z } from "zod";

export const notificationSettingsSchema = z.object({
  emailNotifications: z.boolean().default(true),
  marketingEmails: z.boolean().default(false),
  productUpdates: z.boolean().default(true),
  securityAlerts: z.boolean().default(true),
});

export const appearanceSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).default("system"),
  sidebarCollapsed: z.boolean().default(false),
});

export const securitySettingsSchema = z.object({
  currentPassword: z.string().min(6).optional(),
  newPassword: z.string().min(8).optional(),
  confirmNewPassword: z.string().optional(),
  twoFactorEnabled: z.boolean().default(false),
}).refine(
  (data) => {
    if (data.newPassword && data.newPassword !== data.confirmNewPassword) {
      return false;
    }
    return true;
  },
  {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  }
);

export type NotificationSettingsInput = z.infer<typeof notificationSettingsSchema>;
export type AppearanceSettingsInput = z.infer<typeof appearanceSettingsSchema>;
export type SecuritySettingsInput = z.infer<typeof securitySettingsSchema>;
