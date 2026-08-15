/**
 * 管理后台概览页面（仅限 admin / super_admin）
 * 展示平台级统计数据、最近注册用户、系统状态概览
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { safelyRequireRole } from "@/lib/auth/guards";
import { shouldUseMock, generateMockAdminStats } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Activity, Shield, AlertTriangle } from "lucide-react";

export default async function AdminPage() {
  const auth = await safelyRequireRole("admin");
  if (!auth.success) {
    redirect(ROUTES.dashboard);
  }

  const t = await getTranslations("admin");

  // 获取系统统计数据
  // Mock 模式下直接使用本地模拟数据（createAdminClient 需要真实的 service_role 环境变量）
  let totalUsers: number;
  let totalTeams: number;
  let roleCount: { super_admin: number; admin: number; member: number; viewer: number };

  if (shouldUseMock()) {
    const mock = generateMockAdminStats();
    totalUsers = mock.totalUsers;
    totalTeams = mock.totalTeams;
    roleCount = mock.roleCount;
  } else {
    const supabase = createAdminClient();
    const { count: usersCount } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true });
    const { count: teamsCount } = await supabase
      .from("teams")
      .select("*", { count: "exact", head: true });
    const { data: roles } = await supabase
      .from("profiles")
      .select("role");

    totalUsers = usersCount ?? 0;
    totalTeams = teamsCount ?? 0;
    roleCount = { super_admin: 0, admin: 0, member: 0, viewer: 0 };
    roles?.forEach((p: { role: string }) => {
      if (p.role in roleCount) {
        (roleCount as Record<string, number>)[p.role]++;
      }
    });
  }

  const statsCards = [
    { title: t("overview.stats.totalUsers"), value: totalUsers ?? 0, desc: t("overview.stats.totalUsersDesc"), icon: Users },
    { title: t("overview.stats.totalTeams"), value: totalTeams ?? 0, desc: t("overview.stats.totalTeamsDesc"), icon: Activity },
    { title: t("overview.stats.admins"), value: roleCount.admin + roleCount.super_admin, desc: `super_admin ${roleCount.super_admin} / admin ${roleCount.admin}`, icon: Shield },
    { title: t("overview.stats.normalUsers"), value: roleCount.member + roleCount.viewer, desc: `member ${roleCount.member} / viewer ${roleCount.viewer}`, icon: AlertTriangle },
  ];

  const systemServices = [
    { name: t("overview.services.database"), healthy: true },
    { name: t("overview.services.auth"), healthy: true },
    { name: t("overview.services.storage"), healthy: true },
    { name: t("overview.services.sentry"), healthy: true },
    { name: t("overview.services.stripe"), healthy: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("overview.title")}</h1>
        <p className="text-muted-foreground">{t("overview.desc")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.desc}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 角色分布 */}
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.roleDistribution")}</CardTitle>
            <CardDescription>{t("overview.roleDistributionDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: t("users.roleLabels.super_admin"), count: roleCount.super_admin, color: "bg-red-500" },
                { label: t("users.roleLabels.admin"), count: roleCount.admin, color: "bg-orange-500" },
                { label: t("users.roleLabels.member"), count: roleCount.member, color: "bg-blue-500" },
                { label: t("users.roleLabels.viewer"), count: roleCount.viewer, color: "bg-gray-500" },
              ].map((item) => {
                const max = Math.max(roleCount.super_admin, roleCount.admin, roleCount.member, roleCount.viewer, 1);
                const pct = (item.count / max) * 100;
                return (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{item.label}</span>
                      <span className="text-muted-foreground">{item.count}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted">
                      <div className={`h-2 rounded-full ${item.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* 系统状态 */}
        <Card>
          <CardHeader>
            <CardTitle>{t("overview.systemStatus")}</CardTitle>
            <CardDescription>{t("overview.systemStatusDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {systemServices.map((svc) => (
              <div key={svc.name} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm font-medium">{svc.name}</span>
                <span className="flex items-center gap-1.5 text-sm text-green-600">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {t("overview.services.running")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
