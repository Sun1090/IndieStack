/**
 * Appark APM 轻量接入（v0.5.0 C01，ADR-011）
 *
 * 设计约束：
 * - 无厂商 SDK 依赖：事件经内存队列批量 POST 到可配置的收集端点（fetch 即够），
 *   避免锁定供应商 SDK 与初始化顺序问题。
 * - 默认关闭：`NEXT_PUBLIC_APPARK_API_KEY` 与 `NEXT_PUBLIC_APPARK_ENDPOINT`
 *   齐备才启用；未启用时 track* 只入内存队列（有上限），flush 直接丢弃，零网络开销。
 * - 采样：`NEXT_PUBLIC_APPARK_SAMPLE_RATE` 控制事件级采样，默认 1（100%）；
 *   0 可静音，非法值告警后回退到 1，避免配置笔误静默关闭可观测性。
 * - 失败不抛：APM 属旁路，flush 失败保留事件待下次 flush（队列满丢最旧），
 *   不影响业务主流程。
 */
import { logger } from "@/lib/logger";
import {
  APPARK_SAMPLE_RATE_KEY,
  parseApparkSampleRate,
  shouldSampleApparkEvent,
} from "@/lib/appark-config";
// 版本单一来源与 health 路由一致：package.json version，NEXT_PUBLIC_APP_VERSION 可覆盖
import { version as pkgVersion } from "../../package.json";

export interface ApparkEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
  app_version: string;
}

/** 队列上限：防止未 flush 时无限增长（丢最旧） */
const QUEUE_LIMIT = 200;

let queue: ApparkEvent[] = [];
let initialized = false;
let cachedSampleRate: number | null = null;

function endpoint(): string | undefined {
  return process.env.NEXT_PUBLIC_APPARK_ENDPOINT;
}

export function isApparkEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_APPARK_API_KEY && endpoint());
}

/** 获取进程内缓存的采样率；非法配置告警一次并回退到 100%。 */
export function getApparkSampleRate(): number {
  if (cachedSampleRate !== null) return cachedSampleRate;

  const parsed = parseApparkSampleRate(process.env[APPARK_SAMPLE_RATE_KEY]);
  cachedSampleRate = parsed.rate;
  if (!parsed.valid) {
    logger.warn(
      `[Appark] ${APPARK_SAMPLE_RATE_KEY} 必须是 0 到 1 之间的数字，当前回退到 ${parsed.rate}`,
    );
  }
  return cachedSampleRate;
}

/** 初始化：幂等；仅在 nodejs runtime 由 instrumentation 调用 */
export function initAppark(): void {
  if (initialized) return;
  initialized = true;
  if (isApparkEnabled()) {
    const sampleRate = getApparkSampleRate();
    logger.info(`[Appark] APM 已启用（endpoint: ${endpoint()}，sampleRate: ${sampleRate}）`);
    if (sampleRate === 0) {
      logger.warn("[Appark] 采样率为 0，事件将被静音且不会产生网络请求");
    }
  } else if (process.env.NEXT_PUBLIC_APPARK_API_KEY || endpoint()) {
    logger.warn("[Appark] API_KEY 与 ENDPOINT 需同时配置才启用，当前为旁路关闭状态");
  }
}

function enqueue(event: ApparkEvent): void {
  queue.push(event);
  if (queue.length > QUEUE_LIMIT) {
    queue = queue.slice(queue.length - QUEUE_LIMIT);
  }
}

/** 记录业务事件（注册/结账/cron 运行等关键流程） */
export function trackEvent(name: string, properties: Record<string, unknown> = {}): void {
  if (!shouldSampleApparkEvent(getApparkSampleRate())) return;

  const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? pkgVersion;
  enqueue({ event: name, properties, timestamp: new Date().toISOString(), app_version: appVersion });
}

/** 记录错误事件（APM 侧补充，错误主通道仍是 Sentry） */
export function trackError(name: string, error: unknown): void {
  trackEvent(`error.${name}`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * 批量上报并清空队列；未启用或无事件时为 no-op。
 * 非 2xx 时保留事件（受队列上限约束），由下一次 flush 重试。
 */
export async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;
  if (!isApparkEnabled()) {
    queue = [];
    return;
  }

  const batch = queue;
  try {
    const response = await fetch(endpoint() as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_APPARK_API_KEY}`,
      },
      body: JSON.stringify({ events: batch }),
    });
    if (!response.ok) {
      // 批次仍在队列中未移除，保留即可（受上限约束），下次 flush 重试
      queue = queue.slice(-QUEUE_LIMIT);
      logger.warn(`[Appark] flush 失败: ${response.status}`);
      return;
    }
    queue = queue.slice(batch.length);
  } catch (error) {
    logger.warn(`[Appark] flush 异常: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 测试与运维辅助：清空状态 */
export function resetApparkForTest(): void {
  queue = [];
  initialized = false;
  cachedSampleRate = null;
}
