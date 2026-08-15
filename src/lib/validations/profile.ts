/**
 * 个人资料表单验证规则
 * 使用 Zod 定义用户基本信息编辑表单的校验规则
 */
import { z } from "zod";

export const profileUpdateSchema = z.object({
  fullName: z.string().min(1, "fullNameRequired").max(100).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const profileSettingsSchema = z.object({
  fullName: z.string().trim().min(1, "fullNameRequired").max(100),
  email: z.string().email().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  timezone: z.string().trim().max(100).nullable().optional(),
  language: z.string().trim().max(50).nullable().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ProfileSettingsInput = z.infer<typeof profileSettingsSchema>;
