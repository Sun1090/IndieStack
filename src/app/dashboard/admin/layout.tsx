/**
 * 管理后台布局组件
 * 为 Admin 页面提供权限校验和导航
 * 仅 admin 及以上角色可访问，否则重定向到仪表盘
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { ROUTES } from "@/lib/constants";
import { parseRole } from "@/lib/auth/roles";
import { ROLE_HIERARCHY } from "@/lib/auth/roles";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(ROUTES.login);
  }

  // 从 profiles 表获取用户角色
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    // 缺行是「这个用户还没有 profiles 记录」，按 member 处理；查询失败不是同一件事。
    .maybeSingle();

  if (profileError) {
    // 抛给错误边界，而不是 redirect：读不到角色时把管理员踢回仪表盘，
    // 用户看到的是一条凭空的权限拒绝，日志里却什么都没有。
    throw new Error(`读取管理员角色失败：${profileError.message}`);
  }

  const role = parseRole(profile?.role) ?? "member";

  // 检查角色等级：至少需要 admin（80）权限
  if ((ROLE_HIERARCHY[role] ?? 0) < 80) {
    redirect(ROUTES.dashboard);
  }

  const t = await getTranslations("admin");

  return (
    <div className="space-y-6">
      {/* Admin 导航标签页 */}
      <div className="flex items-center gap-4 border-b pb-3">
        <Link
          href={ROUTES.admin}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("overview.title")}
        </Link>
        <Link
          href={ROUTES.adminUsers}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("users.title")}
        </Link>
        <Link
          href={ROUTES.adminAuditLogs}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("auditLogs.title")}
        </Link>
        <Link
          href={ROUTES.adminWebhooks}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("webhookLogs.title")}
        </Link>
        <Link
          href={ROUTES.adminMessages}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("messages.title")}
        </Link>
      </div>
      {children}
    </div>
  );
}
