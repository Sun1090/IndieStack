/**
 * 审计日志仅允许 super_admin 访问
 * 父级 layout 只放行 admin，这里再做一次更严格的校验
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";

export default async function AuditLogsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    // 读不到角色不等于「不是 super_admin」：redirect 会把它答成一条权限拒绝。
    throw new Error(`读取 super_admin 角色失败：${profileError.message}`);
  }

  if (profile?.role !== "super_admin") {
    redirect(ROUTES.admin);
  }

  return children;
}
