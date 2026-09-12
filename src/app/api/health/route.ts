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

type DependencyStatus = "ok" | "missing" | "unreachable" | "skipped";

export const dynamic = "force-dynamic";

/** 轻量探测 DB 可达性：limit(1) 索引扫描；未配置时跳过不断连 */
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
    const timeout = new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), REACHABLE_TIMEOUT_MS),
    );
    return await Promise.race([probe, timeout]);
  } catch {
    return false;
  }
}

function isMockMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_MOCK_ENABLED === "true" ||
    (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

export async function GET() {
  const uptime = Math.floor((Date.now() - startupTime) / 1000);
  const mockMode = isMockMode();
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const supabaseReachable = await checkSupabaseReachable(supabaseConfigured);
  const supabaseStatus: DependencyStatus = mockMode
    ? "skipped"
    : !supabaseConfigured
      ? "missing"
      : supabaseReachable
        ? "ok"
        : "unreachable";

  const checks = {
    supabase: {
      required: !mockMode,
      configured: supabaseConfigured,
      reachable: mockMode ? null : supabaseReachable,
      status: supabaseStatus,
    },
    sentry: {
      required: false,
      configured: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
      status: (process.env.NEXT_PUBLIC_SENTRY_DSN ? "ok" : "missing") as DependencyStatus,
    },
    stripe: {
      required: false,
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
      status: (process.env.STRIPE_SECRET_KEY ? "ok" : "missing") as DependencyStatus,
    },
  };

  const requiredChecks = Object.values(checks).filter((check) => check.required);
  const ready = requiredChecks.every(
    (check) => check.configured && ("reachable" in check ? check.reachable === true : true),
  );
  const degraded = requiredChecks.some(
    (check) => check.configured && "reachable" in check && check.reachable === false,
  );
  const status = !ready ? (degraded ? "degraded" : "error") : "ok";

  const body = {
    status,
    timestamp: new Date().toISOString(),
    uptime,
    uptimeFormatted: formatUptime(uptime),
    // 单一来源：package.json version（构建时内联，本文件仅服务端运行）；
    // 部署时可用 NEXT_PUBLIC_APP_VERSION 显式覆盖
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? pkgVersion,
    environment: process.env.NODE_ENV,
    mockMode,
    checks,
    // 兼容旧消费者：表示所有依赖（含可选依赖）是否已配置。
    allConfigured: Object.values(checks).every((check) => check.configured),
    ready,
    degraded,
  };

  return jsonNoStore(body, {
    status: status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, must-revalidate",
    },
  });
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
