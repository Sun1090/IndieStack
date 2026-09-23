/**
 * 分析 API 路由
 * 提供仪表盘分析页面的数据接口
 * 支持按时间范围获取页面浏览量、独立访客、事件等指标
 *
 * GET /api/analytics?range=7|14|30
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { safelyRequireAuth } from "@/lib/auth/guards";
import { logApiError } from "@/lib/api-log";

export const dynamic = "force-dynamic";

/** `api_usage` 时间序列里这张图真正用到的列。 */
type UsageRow = {
  created_at: string;
  status_code: number | null;
  user_id: string | null;
  path: string;
  method: string;
};

/**
 * GET /api/analytics
 * 获取分析汇总数据和趋势图表数据
 */
export async function GET(request: NextRequest) {
  // 速率限制
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  // 权限校验
  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return jsonNoStore({ error: auth.error.message }, { status: 401 });
  }
  const userId = auth.data.id;

  const { searchParams } = new URL(request.url);
  const range = Math.min(Math.max(Number(searchParams.get("range")) || 30, 1), 90);

  try {
    const supabase = await createClient();
    // 按 UTC 自然日对齐窗口（与下方 toISOString().slice 的日键一致，避免时区错位）：
    // 覆盖含今天在内的最近 range 个完整日
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (range - 1));

    // 统计总指标
    const [pageViewsResult] = await Promise.all([
      supabase
        .from("api_usage")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", since.toISOString()),
    ]);

    // 这两次读取决定这张图上的每一个数字，而失败方向一模一样：读失败会长成
    // 「0 个请求、0 个错误、空时间线」。对一个正在用密钥的账户来说，那就是「你的密钥没人用」——
    // 空图必须是**真的没有行**，不能是「我们没读到」。
    if (pageViewsResult.error) {
      await logApiError("[Analytics API] 请求总数读取失败", pageViewsResult.error);
      return jsonNoStore({ error: "Could not read your usage totals. Please retry." }, { status: 503 });
    }

    // 获取时间序列数据。这里刻意保留一个**带 `error` 成员**的结果类型：这条链 await 下来是
    // `any`（列名串没匹配上生成的关系类型），而 `any` 正是「读失败看不见」的成因——
    // 断言本身没问题，把 `error` 从断言里抹掉才有问题（C08 抓的是后者）。
    const { data: dailyData, error: dailyError } = (await supabase
      .from("api_usage")
      .select("created_at, status_code, user_id, path, method")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: true })) as {
      data: UsageRow[] | null;
      error: { message: string } | null;
    };

    if (dailyError) {
      await logApiError("[Analytics API] 用量时间序列读取失败", dailyError);
      return jsonNoStore({ error: "Could not read your usage timeline. Please retry." }, { status: 503 });
    }

    // 组装时间序列
    const dailyMap = new Map<string, { requests: number; errors: number }>();
    for (let i = 0; i < range; i++) {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
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

    return jsonNoStore({
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
    await logApiError("[Analytics API] 获取分析数据失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
