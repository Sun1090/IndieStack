/**
 * 仪表盘总览页面
 * 显示项目统计概览、快捷操作、订阅信息和最近活动
 * 数据来自 Supabase 服务端查询，支持国际化
 */

export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { getTranslations } from "next-intl/server";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Users, CreditCard, TrendingUp } from "lucide-react";
import { ROUTES } from "@/lib/constants";
import type { Database } from "@/lib/supabase/database.types";
import Link from "next/link";

export default async function DashboardOverview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // 加载仪表盘命名空间的翻译
  const td = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  // 获取用户资料
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single() as unknown as { data: Database["public"]["Tables"]["profiles"]["Row"] | null; error: null };

  // 获取团队信息
  const { data: membership } = await supabase
    .from("team_members")
    .select("team_id, teams(name, plan, member_count)")
    .eq("user_id", user!.id)
    .limit(1)
    .single() as unknown as { data: { team_id: string; teams: { name: string; plan: string; member_count: number } } | null; error: null };

  const currentPlan = (membership?.teams as unknown as { plan: string })?.plan ?? "free";

  return (
    <div className="space-y-8">
      {/* 欢迎语区域 */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {td("overview.welcomeBack")}{profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="text-muted-foreground">{td("overview.todaySummary")}</p>
      </div>

      {/* 统计卡片网格 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title={td("overview.stats.revenue")}
          value="$12,234"
          description={td("overview.stats.last30Days")}
          icon={CreditCard}
          trend={{ value: 12.5, positive: true }}
        />
        <StatsCard
          title={td("overview.stats.activeUsers")}
          value="573"
          description={td("overview.stats.last30Days")}
          icon={Users}
          trend={{ value: 8.1, positive: true }}
        />
        <StatsCard
          title={td("overview.stats.apiCalls")}
          value="84,231"
          description={td("overview.stats.last30Days")}
          icon={Activity}
          trend={{ value: 3.2, positive: false }}
        />
        <StatsCard
          title={td("overview.stats.growthRate")}
          value="23.1%"
          description={td("overview.stats.monthOverMonth")}
          icon={TrendingUp}
          trend={{ value: 2.4, positive: true }}
        />
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
                <Badge variant={currentPlan === "enterprise" ? "default" : currentPlan === "pro" ? "secondary" : "outline"}>
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
              <p className="text-sm font-medium">{membership?.teams ? (membership.teams as unknown as { member_count: number }).member_count : 1}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{td("overview.plan.storageUsed")}</p>
              <p className="text-sm font-medium">1.2 GB / 50 GB</p>
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
              {[
                { action: td("overview.activity.items.0.action"), project: "api-service", time: td("overview.activity.items.0.time"), type: "success" as const },
                { action: td("overview.activity.items.1.action"), project: "main-db", time: td("overview.activity.items.1.time"), type: "success" as const },
                { action: td("overview.activity.items.2.action"), project: "Engineering", time: td("overview.activity.items.2.time"), type: "info" as const },
                { action: td("overview.activity.items.3.action"), project: "app.example.com", time: td("overview.activity.items.3.time"), type: "info" as const },
                { action: td("overview.activity.items.4.action"), project: "worker-01", time: td("overview.activity.items.4.time"), type: "warning" as const },
              ].map((activity, i) => (
                <div key={i} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${
                      activity.type === "success" ? "bg-green-500" :
                      activity.type === "warning" ? "bg-yellow-500" : "bg-blue-500"
                    }`} />
                    <div>
                      <p className="text-sm font-medium">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">{activity.project}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{activity.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
