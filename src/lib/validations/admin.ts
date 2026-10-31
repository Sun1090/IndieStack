/**
 * 管理后台的入参校验（运行时）。
 *
 * **为什么这里必须有它**：`updateUserRole` 是 `"use server"` 导出，参数在客户端
 * 序列化后**重新**传进来，TypeScript 的联合类型那一刻已经不存在了。
 * 而 `ASSIGNABLE_USER_ROLES`（`src/lib/constants.ts`，注释写着「刻意不含 super_admin」）
 * 此前只被下拉菜单用来渲染选项——**它从来没有参与过服务端判定**。
 * 于是 `POST` 一个 `role: "super_admin"` 的请求，会经过
 * 「调用者是 admin ✓、目标不是 super_admin ✓」两道判定，把目标（包括自己）写成
 * super_admin：这是本仓库里唯一一处**能靠一次请求完成的提权**。
 *
 * 与 `validations/team.ts` 同一套做法（zod + 从常量派生的枚举），
 * 这样「允许哪些值」只有一个事实源，加角色时两处不会漂。
 */
import { z } from "zod";
import { ASSIGNABLE_USER_ROLES } from "@/lib/constants";

/**
 * 可授予的账户角色。取值直接来自 `ASSIGNABLE_USER_ROLES`，**不在这里另抄一份**：
 * 抄一份的下场是「常量改了、校验没改」，那正是这条缺陷的成因。
 * `[...]` 展开是因为 zod 的 `z.enum` 要的是可变元组，而常量是 `as const`。
 */
export const assignableUserRoleSchema = z.enum([...ASSIGNABLE_USER_ROLES]);

export const updateUserRoleSchema = z.object({
  /**
   * 目标用户 id。刻意**不**校验成 uuid：这一列的主键形态由数据库负责，
   * 而「这个 id 存不存在」已经由 `updateUserRole` 的那次读取回答（`userNotFoundAdmin`）。
   * 在这里再判一次格式只会把「不存在」和「格式不对」混成同一个错误。
   */
  userId: z.string().min(1).max(64),
  role: assignableUserRoleSchema,
});

export type AssignableUserRole = z.infer<typeof assignableUserRoleSchema>;
