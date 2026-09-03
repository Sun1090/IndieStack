/**
 * 健康检查 API
 * 用于负载均衡器、Docker HEALTHCHECK、监控系统的心跳检测
 * 返回服务状态、运行时间和依赖连通性
 *
 * GET /api/health
 */

import { jsonNoStore } from "@/lib/api-response";
import { version as pkgVersion } from "../../../../package.json";

/** 服务启动时间（进程级） */
const startupTime = Date.now();

/** DB 可达性探测超时（健康检查永不 hanging） */
const REACHABLE_TIMEOUT_MS = 3000;

export const dynamic = "force-dynamic";

/** 轻量探测 DB 可达性：limit(1) 索引扫描；无配置时跳过不断连 */
async function checkSupabaseReachable(configured: boolean): Promise<boolean> {
  if (!configured) return false;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const probe = createAdminClient()
      .from("profiles")
      .select("id")
      .limit(1)
      .maybeSingle()
      .then(
        () => true,
        () => false,
      );
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), REACHABLE_TIMEOUT_MS));
    return await Promise.race([probe, timeout]);
  } catch {
    return false;
  }
}

export async function GET() {
  const uptime = Math.floor((Date.now() - startupTime) / 1000);
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const status = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime,
    uptimeFormatted: formatUptime(uptime),
    // 单一来源：package.json version（构建时内联，本文件仅服务端运行）；
    // 部署时可用 NEXT_PUBLIC_APP_VERSION 显式覆盖
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? pkgVersion,
    environment: process.env.NODE_ENV,
    checks: {
      // Supabase：configured 看 env；reachable 做一次轻量真实探测
      supabase: {
        configured: supabaseConfigured,
        reachable: await checkSupabaseReachable(supabaseConfigured),
      },
      // Sentry 检测
      sentry: {
        configured: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
      },
      // Stripe 检测
      stripe: {
        configured: Boolean(process.env.STRIPE_SECRET_KEY),
      },
    },
  };

  // 检查是否所有核心依赖都已配置
  const allConfigured = Object.values(status.checks).every((check) => check.configured);

  return jsonNoStore(
    { ...status, allConfigured },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, must-revalidate",
      },
    },
  );
}

/** 将秒数格式化为可读的时长字符串 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
