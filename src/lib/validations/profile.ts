/**
 * 个人资料表单验证规则
 * 使用 Zod 定义用户基本信息编辑表单的校验规则
 */
import { z } from "zod";

export const profileUpdateSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const profileSettingsSchema = z.object({
  fullName: z.string().min(1, "Full name is required").max(100),
  email: z.string().email().optional(),
  bio: z.string().max(500).optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ProfileSettingsInput = z.infer<typeof profileSettingsSchema>;
