/**
 * 仪表盘总览页面
 * 显示项目统计概览、快捷操作、订阅信息和最近活动
 * 数据来自 Supabase 服务端查询，支持国际化
 */

export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Users, CreditCard, FolderKanban } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import Link from "next/link";
import { formatNumber } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/date";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("overview.metaTitle"), description: t("overview.metaDesc") };
}

export default async function DashboardOverview() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 加载仪表盘命名空间的翻译
  const td = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  // 获取用户资料
  const { data: profile } = (await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single()) as unknown as {
    data: Database["public"]["Tables"]["profiles"]["Row"] | null;
    error: null;
  };

  // 获取团队信息
  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id, teams(name, plan, member_count)")
    .eq("user_id", user!.id)
    .limit(1)
    .single()) as unknown as {
    data: { team_id: string; teams: { name: string; plan: string; member_count: number } } | null;
    error: null;
  };

  const teamInfo = membership?.teams as unknown as
    { name: string; plan: string; member_count: number } | undefined;
  const currentPlan = teamInfo?.plan ?? "free";

  const since30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const teamId = membership?.team_id;

  const [
    { count: projectCount },
    { count: apiCallCount },
    { count: sessionCount },
    { data: notifications },
  ] = await Promise.all([
    teamId
      ? supabase.from("projects").select("*", { count: "exact", head: true }).eq("team_id", teamId)
      : { count: 0 },
    supabase
      .from("api_usage")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .gte("created_at", since30Days),
    supabase
      .from("user_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .gte("created_at", since30Days),
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(5) as unknown as {
      data: Database["public"]["Tables"]["notifications"]["Row"][] | null;
    },
  ]);

  const locale = await getLocale();
  const recentActivity = (notifications ?? []).map((notification) => ({
    id: String(notification.id),
    title: String(notification.title ?? ""),
    body: String(notification.body ?? ""),
    time: formatRelativeTime(String(notification.created_at), { locale }),
    type: String(notification.type ?? "info"),
  }));

  const stats = [
    {
      title: td("overview.stats.projects"),
      value: formatNumber(projectCount ?? 0),
      description: td("overview.stats.projectsDesc"),
      icon: FolderKanban,
    },
    {
      title: td("overview.stats.apiCalls"),
      value: formatNumber(apiCallCount ?? 0),
      description: td("overview.stats.apiCallsDesc"),
      icon: Activity,
    },
    {
      title: td("overview.stats.sessions"),
      value: formatNumber(sessionCount ?? 0),
      description: td("overview.stats.sessionsDesc"),
      icon: Users,
    },
    {
      title: td("overview.stats.teamMembers"),
      value: formatNumber(teamInfo?.member_count ?? 1),
      description: td("overview.stats.teamMembersDesc"),
      icon: CreditCard,
    },
  ];

  const activityDotColor = (type: string) => {
    if (type === "success") return "bg-green-500";
    if (type === "warning") return "bg-yellow-500";
    if (type === "error") return "bg-red-500";
    return "bg-blue-500";
  };

  return (
    <div className="space-y-8">
      {/* 欢迎语区域 */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {td("overview.welcomeBack")}
          {profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-muted-foreground">{td("overview.todaySummary")}</p>
      </div>

      {/* 统计卡片网格 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <StatsCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            description={stat.description}
            icon={stat.icon}
          />
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* 当前方案卡片 */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{td("overview.plan.title")}</CardTitle>
            <CardDescription>{td("overview.plan.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{tc("plan")}</p>
                <Badge
                  variant={
                    currentPlan === "enterprise"
                      ? "default"
                      : currentPlan === "pro"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                </Badge>
              </div>
              <Link
                href={ROUTES.dashboardBilling}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {td("overview.plan.upgrade")}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{td("overview.plan.teamMembers")}</p>
              <p className="text-sm font-medium">{teamInfo?.member_count ?? 1}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{td("overview.plan.storageUsed")}</p>
              <p className="text-sm font-medium">—</p>
            </div>
          </CardContent>
        </Card>

        {/* 最近活动卡片 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{td("overview.activity.title")}</CardTitle>
            <CardDescription>{td("overview.activity.desc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">{td("overview.activity.empty")}</p>
              ) : (
                recentActivity.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${activityDotColor(activity.type)}`} />
                      <div>
                        <p className="text-sm font-medium">{activity.title}</p>
                        {activity.body && (
                          <p className="text-xs text-muted-foreground">{activity.body}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{activity.time}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
