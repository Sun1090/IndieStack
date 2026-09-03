/**
 * 健康检查 API
 * 用于负载均衡器、Docker HEALTHCHECK、监控系统的心跳检测
 * 返回服务状态、运行时间和依赖连通性
 *
 * GET /api/health
 */

import { NextResponse } from "next/server";
import { version as pkgVersion } from "../../../../package.json";

/** 服务启动时间（进程级） */
const startupTime = Date.now();

export const dynamic = "force-dynamic";

export async function GET() {
  const uptime = Math.floor((Date.now() - startupTime) / 1000);

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
      // Supabase 连接检测（通过检查必需的配置变量）
      supabase: {
        configured: Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        ),
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

  return NextResponse.json(
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
