/**
 * 分析 API 路由
 * 提供仪表盘分析页面的数据接口
 * 支持按时间范围获取页面浏览量、独立访客、事件等指标
 *
 * GET /api/analytics?range=7|14|30
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { safelyRequireAuth } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * GET /api/analytics
 * 获取分析汇总数据和趋势图表数据
 */
export async function GET(request: NextRequest) {
  // 速率限制
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  // 权限校验
  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 401 });
  }
  const userId = auth.data.id;

  const { searchParams } = new URL(request.url);
  const range = Math.min(Math.max(Number(searchParams.get("range")) || 30, 1), 90);

  try {
    const supabase = await createClient();
    const since = new Date();
    since.setDate(since.getDate() - range);

    // 统计总指标
    const [pageViewsResult] = await Promise.all([
      supabase
        .from("api_usage")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", since.toISOString()),
    ]);

    // 获取时间序列数据
    const { data: dailyData } = (await supabase
      .from("api_usage")
      .select("created_at, status_code, user_id, path, method")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })) as unknown as {
      data: Array<{
        created_at: string;
        status_code: number | null;
        user_id: string | null;
        path: string;
        method: string;
      }> | null;
    };

    // 组装时间序列
    const dailyMap = new Map<string, { requests: number; errors: number }>();
    for (let i = 0; i < range; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      dailyMap.set(d.toISOString().slice(0, 10), { requests: 0, errors: 0 });
    }

    let totalErrors = 0;
    for (const row of dailyData ?? []) {
      const key = row.created_at.slice(0, 10);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.requests++;
        if (row.status_code && row.status_code >= 400) {
          entry.errors++;
          totalErrors++;
        }
      }
    }

    const timeline = Array.from(dailyMap.entries()).map(([date, stats]) => ({
      date,
      ...stats,
    }));

    const totalRequests = pageViewsResult.count ?? 0;
    // 数据已按当前用户过滤，uniqueVisitors 反映该用户在统计周期内是否有活跃记录
    const uniqueVisitors = (dailyData ?? []).some((row) => Boolean(row.user_id)) ? 1 : 0;
    const recent = (dailyData ?? [])
      .slice(-10)
      .reverse()
      .map((row) => ({
        path: row.path,
        method: row.method,
        status_code: row.status_code,
        created_at: row.created_at,
      }));

    return NextResponse.json({
      summary: {
        totalRequests,
        uniqueVisitors,
        totalErrors,
        errorRate: totalRequests > 0 ? Number(((totalErrors / totalRequests) * 100).toFixed(1)) : 0,
      },
      timeline,
      recent,
      range,
    });
  } catch (error) {
    console.error("[Analytics API] 获取分析数据失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
