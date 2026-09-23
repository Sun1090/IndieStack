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
import { EmptyState } from "@/components/shared/empty-state";
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

/** 服务端动态页：渲染时刻计算窗口起点（react-hooks/purity 对动态 RSC 误报的规避） */
function thirtyDaysAgoIso(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export default async function DashboardOverview() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 加载仪表盘命名空间的翻译
  const td = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  // 获取用户资料
  // 这几处断言原先都明写着 `error: null`——那不是「保留了错误通道」，是断言「这次查询不可能出错」。
  // 后果是这个首页（多数用户进来看到的第一屏）会把一次抖动渲染成一堆合法的终态：
  // 0 个项目、0 次调用、0 个会话、没有通知、套餐显示成 free。
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .maybeSingle();
  if (profileError) {
    throw new Error(`读取个人资料失败：${profileError.message}`);
  }

  // 获取团队信息
  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id, teams(name, plan, member_count)")
    .eq("user_id", user!.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) {
    throw new Error(`读取团队归属失败：${membershipError.message}`);
  }

  const teamInfo = membership?.teams ?? null;
  const currentPlan = teamInfo?.plan ?? "free";

  const since30Days = thirtyDaysAgoIso();
  const teamId = membership?.team_id;

  const [
    { count: projectCount, error: projectError },
    { count: apiCallCount, error: apiCallError },
    { count: sessionCount, error: sessionError },
    { data: notifications, error: notificationsError },
  ] = await Promise.all([
    // 没有团队是合法状态（个人用户本来就没有项目），所以这里给的是 0 而不是错误；
    // 但「查了没查到」与「没查成」仍然要分开，故两支都带 `error`。
    teamId
      ? supabase.from("projects").select("*", { count: "exact", head: true }).eq("team_id", teamId)
      : { count: 0, error: null },
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
    // 这条断言**留着**，因为不写它 `notifications` 会被推断成 `any`（Promise.all 里混了
    // `{ count, error }` 的字面量分支，链的类型在这里合不起来）。与上面被删掉的那几条的差别是：
    // 它带 `error` 成员，所以说的是「错误可能存在，而我会去看」——下面 `notificationsError` 真的在看。
    supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(5) as unknown as {
      data: NotificationRow[] | null;
      error: { message: string } | null;
    },
  ]);

  // 四个数字拼成的是「你的产品有人用吗」这张图：原先任何一路失败都会落成 0，
  // 读起来就像「还没人用」，而真实原因可能是我们没读到。
  if (projectError) throw new Error(`读取项目数失败：${projectError.message}`);
  if (apiCallError) throw new Error(`读取 API 调用数失败：${apiCallError.message}`);
  if (sessionError) throw new Error(`读取会话数失败：${sessionError.message}`);
  if (notificationsError) throw new Error(`读取最近通知失败：${notificationsError.message}`);

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
    if (type === "success") return "bg-success";
    if (type === "warning") return "bg-warning";
    if (type === "error") return "bg-destructive";
    return "bg-info";
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
                className="text-primary text-sm underline-offset-4 hover:underline"
              >
                {td("overview.plan.upgrade")}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">{td("overview.plan.teamMembers")}</p>
              <p className="text-sm font-medium">{teamInfo?.member_count ?? 1}</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-muted-foreground text-sm">{td("overview.plan.storageUsed")}</p>
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
                <EmptyState
                  icon={Activity}
                  title={td("overview.activity.empty")}
                  className="py-6"
                />
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
                          <p className="text-muted-foreground text-xs">{activity.body}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-muted-foreground text-xs">{activity.time}</span>
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
