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
  const { data: profile } = (await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single()) as { data: { role: string } | null };

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
