/**
 * 环境变量校验
 * 服务端启动时（首个使用方 import）输出配置诊断，生产环境缺失核心变量打警告。
 * 不做 fail-fast：Mock 模式与降级路径依赖"缺省可用"语义（见 lib/mock/config.ts）。
 */
import { logger } from "@/lib/logger";

export interface EnvReport {
  ok: boolean;
  problems: string[];
}

let cached: EnvReport | null = null;

function collect(): EnvReport {
  const problems: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL 未设置（本地开发可启用 Mock 模式）");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY 未设置");
  }
  // service_role 与 URL 必须成对出现，否则 admin 客户端会启动即抛错
  if (!!process.env.SUPABASE_SERVICE_ROLE_KEY !== !!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY 与 NEXT_PUBLIC_SUPABASE_URL 应同时提供");
  }
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://")
  ) {
    problems.push("生产环境建议设置 NEXT_PUBLIC_APP_URL 为 https 绝对地址");
  }
  // OSS 双驱动（ADR-010）：任一变量出现但四项不齐备即告警（运行时回退 Supabase Storage）
  const ossVars = ["OSS_BUCKET", "OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET"];
  const ossCount = ossVars.filter((k) => process.env[k]).length;
  if (ossCount > 0 && ossCount < ossVars.length) {
    problems.push("OSS_* 配置不完整（需 BUCKET/REGION/ACCESS_KEY_ID/ACCESS_KEY_SECRET 四项），已回退 Supabase Storage");
  }
  // Appark APM（ADR-011）：KEY 与 ENDPOINT 需同时配置，缺一则旁路关闭
  if (!!process.env.NEXT_PUBLIC_APPARK_API_KEY !== !!process.env.NEXT_PUBLIC_APPARK_ENDPOINT) {
    problems.push("NEXT_PUBLIC_APPARK_API_KEY 与 NEXT_PUBLIC_APPARK_ENDPOINT 应同时提供（APM 当前旁路关闭）");
  }

  return { ok: problems.length === 0, problems };
}

/** 获取环境诊断结果（进程内缓存一次） */
export function getEnvReport(): EnvReport {
  cached ??= collect();
  return cached;
}

/** 服务端调用：有问题时输出一次性警告日志 */
export function warnOnEnvProblems(): void {
  const report = getEnvReport();
  if (!report.ok) {
    for (const p of report.problems) {
      logger.warn(`[env] ${p}`);
    }
  }
}
