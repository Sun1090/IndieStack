/**
 * 团队管理表单验证规则
 * 使用 Zod 定义创建团队、邀请成员等表单的校验规则
 */
import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1, "Team name is required").max(100),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
});

export const inviteMemberSchema = z.object({
  team_id: z.string().uuid().optional(),
  email: z.string().email("Please enter a valid email address"),
  role: z.enum(["admin", "member"]).default("member"),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
