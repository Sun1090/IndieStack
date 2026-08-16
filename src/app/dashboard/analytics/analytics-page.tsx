"use client";

/**
 * 分析页面 — 仪表盘数据分析
 * 从 /api/analytics 获取真实统计数据、趋势图和最近请求记录
 * 支持时间范围切换与 CSV 导出
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { AreaChart } from "@/components/charts/area-chart";
import { downloadCsv } from "@/lib/csv";
import { formatNumber } from "@/lib/utils";
import { BarChart3, TrendingUp, Users, Activity, Download, ChevronDown, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const RANGE_OPTIONS = [
  { key: "analytics.last7Days", value: 7 },
  { key: "analytics.last14Days", value: 14 },
  { key: "analytics.last30Days", value: 30 },
] as const;

type AnalyticsData = {
  summary: {
    totalRequests: number;
    uniqueVisitors: number;
    totalErrors: number;
    errorRate: number;
  };
  timeline: { date: string; requests: number; errors: number }[];
  recent: { path: string; method: string; status_code: number | null; created_at: string }[];
};

export function AnalyticsPage() {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>(30);
  const [showRangeMenu, setShowRangeMenu] = useState(false);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  // 请求序号：切换 range 时丢弃过期响应，避免旧请求覆盖新数据（竞态）
  const requestSeq = useRef(0);
  const loadData = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/analytics?range=${range}`);
      if (!response.ok) throw new Error("Failed to load analytics");
      const payload = (await response.json()) as AnalyticsData;
      if (seq === requestSeq.current) setData(payload);
    } catch {
      if (seq === requestSeq.current) setData(null);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const statsCards = [
    { labelKey: "analytics.stats.requests", value: data ? formatNumber(data.summary.totalRequests) : "—", icon: BarChart3 },
    { labelKey: "analytics.stats.uniqueVisitors", value: data ? formatNumber(data.summary.uniqueVisitors) : "—", icon: Users },
    { labelKey: "analytics.stats.errors", value: data ? formatNumber(data.summary.totalErrors) : "—", icon: Activity },
    { labelKey: "analytics.stats.errorRate", value: data ? `${data.summary.errorRate}%` : "—", icon: TrendingUp },
  ];

  function formatEventTime(iso: string) {
    const date = new Date(iso);
    // 非法/空日期直接回退，避免 Intl.DateTimeFormat 抛 RangeError
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("analytics.title")} description={t("analytics.desc")}>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!data}
            onClick={() => data && downloadCsv(data.timeline, `analytics-export-${new Date().toISOString().slice(0, 10)}.csv`)}
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
              <p className="text-xs text-muted-foreground">{t("analytics.vsLastPeriod")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("analytics.usageOverview.title")}</CardTitle>
            <CardDescription>{t("analytics.usageOverview.desc")}</CardDescription>
          </div>
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : data ? (
            <AreaChart
              data={data.timeline}
              requestLabel={t("analytics.stats.requests")}
              errorLabel={t("analytics.stats.errors")}
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">{t("analytics.recentEvents.empty")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("analytics.recentEvents.title")}</CardTitle>
          <CardDescription>{t("analytics.recentEvents.desc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data || data.recent.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("analytics.recentEvents.empty")}</p>
          ) : (
            <div className="space-y-3">
              {data.recent.map((event, i) => {
                const isError = event.status_code !== null && event.status_code >= 400;
                return (
                  <div key={`${event.created_at}-${i}`} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${isError ? "bg-red-500" : "bg-green-500"}`} />
                      <span className="text-sm font-medium">{event.method}</span>
                      <span className="font-mono text-xs text-muted-foreground">{event.path}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className={isError ? "font-medium text-red-600" : ""}>{event.status_code ?? "—"}</span>
                      <span>{formatEventTime(event.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
