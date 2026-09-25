/**
 * 健康检查 API
 * 用于负载均衡器、Docker HEALTHCHECK、监控系统的心跳检测
 * 返回服务状态、构建身份（version + commit）、运行时间和依赖连通性
 *
 * GET /api/health
 */

import { jsonNoStore } from "@/lib/api-response";
import { evaluateMockMode } from "@/lib/mock/config";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { version as pkgVersion } from "../../../../package.json";

/** 服务启动时间（进程级） */
const startupTime = Date.now();

/** DB 可达性探测超时（健康检查永不 hanging） */
const REACHABLE_TIMEOUT_MS = 3000;

type DependencyStatus = "ok" | "missing" | "unreachable" | "skipped";

export const dynamic = "force-dynamic";

/** 轻量探测 DB 可达性：使用公开 anon 身份 limit(1)，不借 service_role 做健康检查 */
async function checkSupabaseReachable(configured: boolean): Promise<boolean> {
  if (!configured) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  try {
    const probe = createClient<Database>(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
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
  // 与中间件、provider 诊断共用一份真值表（含生产闸门），这里不要再自己写一遍条件。
  return evaluateMockMode(process.env);
}

export async function GET() {
  const uptime = Math.floor((Date.now() - startupTime) / 1000);
  const mockMode = isMockMode();
  // readiness 仍需三个 Supabase 凭据齐全：探测走 anon（最小权限），但 server 端功能
  // （webhook / cron / 跨用户写入）依赖 service_role。缺它时部署是配置错误，必须报 503。
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

  // 构建内联优先（它标识被构建的那份代码），其次才是运行时变量；空串按「未知」处理。
  const commit =
    [process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA, process.env.VERCEL_GIT_COMMIT_SHA].find(
      (value) => Boolean(value && value.trim()),
    ) ?? null;

  const body = {
    status,
    timestamp: new Date().toISOString(),
    uptime,
    uptimeFormatted: formatUptime(uptime),
    // 单一来源：package.json version（构建时内联，本文件仅服务端运行）；
    // 部署时可用 NEXT_PUBLIC_APP_VERSION 显式覆盖
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? pkgVersion,
    // 只有 version 说明不了「哪个 commit」。发布证据要求能证明「部署的 commit == 验证过的
    //  commit」，缺这个字段就只能靠平台控制台的人工截图。Vercel 在构建时提供
    //  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA；本地与 Docker 没有它时返回 null，调用方必须能表达「未知」。
    commit,
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
