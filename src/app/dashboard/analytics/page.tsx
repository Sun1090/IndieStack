"use client";

/**
 * 分析页面 — 仪表盘数据分析
 * 展示应用指标、图表可视化和事件流，支持 CSV 导出
 * 已接入国际化支持
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AreaChart } from "@/components/charts/area-chart";
import { downloadCsv, generateTimeSeriesData, generateRecentEvents } from "@/lib/csv";
import { BarChart3, TrendingUp, Users, Activity, Download, ChevronDown, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

const RANGE_OPTIONS = [
  { key: "last7Days", value: 7 },
  { key: "last14Days", value: 14 },
  { key: "last30Days", value: 30 },
] as const;

export default function AnalyticsPage() {
  const t = useTranslations("dashboard");
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>(30);
  const [showRangeMenu, setShowRangeMenu] = useState(false);

  const chartData = useMemo(() => generateTimeSeriesData(range), [range]);
  const events = useMemo(() => generateRecentEvents(), []);

  const statsCards = [
    { labelKey: "stats.pageViews", value: "84,231", change: "+12.3%", icon: BarChart3, positive: true },
    { labelKey: "stats.uniqueVisitors", value: "12,847", change: "+8.1%", icon: Users, positive: true },
    { labelKey: "stats.bounceRate", value: "32.1%", change: "-2.4%", icon: Activity, positive: true },
    { labelKey: "stats.avgSession", value: "4m 23s", change: "+5.7%", icon: TrendingUp, positive: true },
  ];

  return (
    <div className="space-y-8">
      <PageHeader title={t("analytics.title")} description={t("analytics.desc")}>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(chartData, `analytics-export-${new Date().toISOString().slice(0, 10)}.csv`)}
          >
            <Download className="mr-1 h-4 w-4" />
            {t("analytics.exportCsv")}
          </Button>

          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowRangeMenu(!showRangeMenu)}
              onBlur={() => setTimeout(() => setShowRangeMenu(false), 200)}
            >
              {RANGE_OPTIONS.find((r) => r.value === range) ? t(RANGE_OPTIONS.find((r) => r.value === range)!.key) : t("analytics.last30Days")}
              <ChevronDown className="ml-1 h-4 w-4" />
            </Button>
            {showRangeMenu && (
              <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border bg-popover p-1 shadow-md">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full rounded-sm px-3 py-1.5 text-left text-sm hover:bg-accent ${
                      opt.value === range ? "bg-accent font-medium" : ""
                    }`}
                    onMouseDown={() => { setRange(opt.value); setShowRangeMenu(false); }}
                  >
                    {t(opt.key)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statsCards.map((stat) => (
          <Card key={stat.labelKey}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t(stat.labelKey)}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className={`text-xs ${stat.positive ? "text-green-600" : "text-red-600"}`}>
                {stat.change} {t("analytics.vsLastPeriod")}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="md:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("analytics.usageOverview.title")}</CardTitle>
            <CardDescription>{t("analytics.usageOverview.desc")}</CardDescription>
          </div>
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <AreaChart data={chartData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.recentEvents.title")}</CardTitle>
          <CardDescription>{t("analytics.recentEvents.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {events.map((evt: Record<string, unknown>, i: number) => (
              <div key={i} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <SeverityDot severity={evt.severity as "info" | "warning" | "success" | "error"} />
                  <span className="text-sm">{evt.event as string}</span>
                </div>
                <span className="text-xs text-muted-foreground">{evt.time as string}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SeverityDot({ severity }: { severity: "info" | "warning" | "success" | "error" }) {
  const colorMap = {
    success: "bg-green-500",
    warning: "bg-yellow-500",
    error: "bg-red-500",
    info: "bg-blue-500",
  } as const;
  return <div className={`h-2 w-2 rounded-full ${colorMap[severity]}`} />;
}
