/**
 * 统计指标卡片组件
 * 用于仪表盘显示关键指标：图标、标签、数值和趋势变化
 * - icon: Lucide 图标组件
 * - label: 指标名称（如页面浏览量）
 * - value: 当前数值
 * - change: 变化百分比（含正负号）
 * - trend: 'up' | 'down' 趋势方向
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    positive: boolean;
  };
  className?: string;
}

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  className,
}: StatsCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {(description || trend) && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {trend && (
              <span
                className={cn("font-medium", trend.positive ? "text-green-600" : "text-red-600")}
              >
                {trend.positive ? "+" : ""}
                {trend.value}%
              </span>
            )}
            {description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
