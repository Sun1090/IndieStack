/**
 * 团队数据访问层（service_role）
 */
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `syncTeamMemberCount()` 的结果：
 * - `synced`：读到了真实行数并写回；
 * - `count-failed`：重算查询失败（含 provider 没回 count 的情况），一个数字都没拿到；
 * - `write-failed`：拿到了真实行数，但那条 UPDATE 没落库。
 */
export type TeamMemberCountSync = "synced" | "count-failed" | "write-failed";

/**
 * 重算并写回 `teams.member_count`。
 *
 * 这一列是**派生缓存**：迁移 007 明写「`teams.member_count` 由服务端重算写入」，数据库侧没有
 * 触发器兜底。于是它只有两种合法状态——等于真实行数，或者保持上一次的旧值。旧实现读不到数字时
 * 写 `count ?? 1`（邀请）/ `count ?? 0`（移除），把「我不知道」写成「7 人的团队只有 1 人」，
 * 而且成员本身**已经改成功了**，回滚不了也不该回滚。现在读不到就不写，只把结果交给调用方上报：
 * 宁可留一个偏旧的数字，也不造一个看着精确的假数字。
 *
 * 返回结果而不是抛错：调用方的主效应（加入/移除成员）已经完成，为一枚缓存把成功说成失败，
 * 会诱导用户重复邀请。
 */
export async function syncTeamMemberCount(teamId: string): Promise<TeamMemberCountSync> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("team_members")
    .select("*", { count: "exact", head: true })
    .eq("team_id", teamId);

  if (error || count === null) return "count-failed";

  const { error: updateError } = await admin
    .from("teams")
    .update({ member_count: count })
    .eq("id", teamId);

  return updateError ? "write-failed" : "synced";
}
