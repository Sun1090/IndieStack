/**
 * 团队管理表单验证规则
 * 使用 Zod 定义创建团队、邀请成员等表单的校验规则
 */
import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().min(1, "teamNameRequired").max(100),
  slug: z
    .string()
    .min(2, "slugMinLength")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "slugInvalid"),
});

/**
 * 团队成员里**可以被授予**的角色。
 *
 * 刻意不含 `owner`：所有权转移是一件单独的事（另有 owner_id 与团队策略保护），
 * 不是「改一下这一行的 role」。数据库的 check 约束允许 `owner`，
 * 所以不在这里挡，「把成员改成 owner」就是一次真提权。
 *
 * 邀请与改角色共用这一份清单——两处各写一遍的下场是
 * 「邀请时挡住 owner、改角色时放行」，而这条链正是本项目里已经踩过的形态。
 */
export const ASSIGNABLE_TEAM_MEMBER_ROLES = ["admin", "member"] as const;

export const inviteMemberSchema = z.object({
  team_id: z.string().uuid().optional(),
  email: z.string().email("invalidEmail"),
  role: z.enum([...ASSIGNABLE_TEAM_MEMBER_ROLES]).default("member"),
});

/**
 * `updateMemberRole` 的运行时入参校验。
 *
 * **为什么必须有**：这个 action 是 `"use server"` 导出的，`newRole: "admin" | "member"`
 * 在客户端序列化、服务端反序列化之后**只剩一个字符串**——类型检查在这一层不存在。
 * 而 `team_members.role` 的 check 约束是 `owner/admin/member` 三者，
 * 于是 `newRole: "owner"` 能一路走到 UPDATE：在 036 之前它被「没有 UPDATE 策略」意外挡住，
 * 补上策略之后就成了一次**把自己或别人变成团队 owner** 的写入。
 * 也就是说 036 与应用层的这道校验是同一件事的两半，必须一起上。
 */
export const updateMemberRoleSchema = z.object({
  /**
   * 成员行 id。与 `validations/admin.ts` 同理，不在这里判 uuid：
   * 「这一行存不存在」由那次读取回答（`memberNotFound`），
   * 在这里再判格式只会把「不存在」和「格式不对」混成同一个错误。
   */
  memberId: z.string().min(1).max(64),
  role: z.enum([...ASSIGNABLE_TEAM_MEMBER_ROLES]),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
