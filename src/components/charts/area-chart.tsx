"use client";

/**
 * 面积图组件
 * 使用 Recharts 绘制面积图，用于展示时间序列数据
 */

import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface AreaChartProps {
  data: { date: string; requests: number; errors: number }[];
  requestLabel?: string;
  errorLabel?: string;
}

export function AreaChart({ data, requestLabel = "Requests", errorLabel = "Errors" }: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <RechartsAreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12 }}
          tickFormatter={(val: string) => val.slice(5)}
          className="text-muted-foreground"
        />
        <YAxis className="text-muted-foreground" tick={{ fontSize: 12 }} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="requests"
          name={requestLabel}
          stroke="hsl(var(--chart-1))"
          fillOpacity={1}
          fill="url(#colorRequests)"
        />
        <Area
          type="monotone"
          dataKey="errors"
          name={errorLabel}
          stroke="hsl(var(--chart-2))"
          fillOpacity={1}
          fill="url(#colorErrors)"
        />
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
