/**
 * Appark APM 集成模块
 * 应用性能监控，提供页面性能追踪、事件上报、错误追踪等功能
 *
 * 使用方式：
 *   import { initAppark, trackEvent, trackError } from "@/lib/appark";
 *   initAppark();
 *   trackEvent("user_signup", { method: "github" });
 *   trackError(new Error("Something went wrong"), { context: "checkout" });
 */

export interface ApparkEventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ApparkConfig {
  apiKey?: string;
  environment?: "development" | "staging" | "production";
  version?: string;
  debug?: boolean;
  sampleRate?: number;
}

let apparkInstance: {
  initialized: boolean;
  config: ApparkConfig;
  sessionId: string;
  userId?: string;
} | null = null;

const eventQueue: Array<{
  name: string;
  properties?: ApparkEventProperties;
  timestamp: number;
}> = [];

let flushTimer: ReturnType<typeof setInterval> | null = null;

const API_ENDPOINT = "https://api.appark.io/v1";
const FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUE_SIZE = 100;

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 初始化 Appark APM，在应用启动时调用 */
export function initAppark(config?: ApparkConfig): void {
  if (apparkInstance?.initialized) {
    if (config?.debug) console.log("[Appark] 已经初始化，跳过重复初始化");
    return;
  }

  const apiKey = config?.apiKey ?? process.env.NEXT_PUBLIC_APPARK_API_KEY ?? "";

  if (!apiKey && (config?.debug ?? process.env.NODE_ENV === "development")) {
    console.warn("[Appark] 未配置 API Key（NEXT_PUBLIC_APPARK_API_KEY），APM 功能不可用");
  }

  apparkInstance = {
    initialized: true,
    config: {
      apiKey,
      environment: config?.environment ?? (process.env.NODE_ENV as ApparkConfig["environment"]) ?? "production",
      version: config?.version ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
      debug: config?.debug ?? process.env.NODE_ENV === "development",
      sampleRate: config?.sampleRate ?? 1.0,
    },
    sessionId: generateSessionId(),
  };

  if (typeof window !== "undefined" && window.performance) {
    recordPagePerformance();
  }

  if (!flushTimer) {
    flushTimer = setInterval(flushEvents, FLUSH_INTERVAL_MS);
  }

  if (apparkInstance.config.debug) {
    console.log("[Appark] 初始化完成", {
      environment: apparkInstance.config.environment,
      sessionId: apparkInstance.sessionId,
    });
  }
}

/** 记录页面加载性能 */
function recordPagePerformance(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("load", () => {
    requestAnimationFrame(() => {
      const navigation = window.performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (!navigation) return;

      const metrics: ApparkEventProperties = {
        dns: navigation.domainLookupEnd - navigation.domainLookupStart,
        tcp: navigation.connectEnd - navigation.connectStart,
        ttfb: navigation.responseStart - navigation.requestStart,
        download: navigation.responseEnd - navigation.responseStart,
        domInteractive: navigation.domInteractive ,
        domComplete: navigation.domComplete ,
        firstPaint: window.performance.getEntriesByType("paint")[0]?.startTime ?? 0,
      };

      queueEvent("page_performance", metrics);
    });
  });
}

/** 记录用户行为事件 */
export function trackEvent(name: string, properties?: ApparkEventProperties): void {
  queueEvent(name, properties);
}

/** 记录错误信息 */
export function trackError(error: Error | unknown, context?: ApparkEventProperties): void {
  const err = error instanceof Error ? error : new Error(String(error));
  queueEvent("error", {
    message: err.message,
    name: err.name,
    stack: err.stack ?? "",
    ...context,
  });
}

/** 设置当前用户 ID */
export function setUserId(userId: string | null): void {
  if (apparkInstance) apparkInstance.userId = userId ?? undefined;
}

function queueEvent(name: string, properties?: ApparkEventProperties): void {
  if (apparkInstance && Math.random() > (apparkInstance.config.sampleRate ?? 1.0)) return;

  eventQueue.push({ name, properties, timestamp: Date.now() });

  if (eventQueue.length >= MAX_QUEUE_SIZE) flushEvents();

  if (apparkInstance?.config.debug) {
    console.log(`[Appark] 事件排队: ${name}`, properties);
  }
}

/** 上报事件队列到服务端 */
export async function flushEvents(): Promise<void> {
  if (eventQueue.length === 0 || !apparkInstance?.config.apiKey || typeof fetch === "undefined") return;

  const events = eventQueue.splice(0, MAX_QUEUE_SIZE);

  try {
    const response = await fetch(`${API_ENDPOINT}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apparkInstance.config.apiKey}`,
      },
      body: JSON.stringify({
        sessionId: apparkInstance.sessionId,
        userId: apparkInstance.userId,
        environment: apparkInstance.config.environment,
        version: apparkInstance.config.version,
        events,
      }),
    });

    if (!response.ok && apparkInstance?.config.debug) {
      console.warn(`[Appark] 上报失败: ${response.status}`);
    }
  } catch (error) {
    if (apparkInstance?.config.debug) console.warn("[Appark] 网络错误", error);
    eventQueue.unshift(...events); // 重新入队
  }
}

/** 销毁 Appark 实例 */
export function destroyAppark(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushEvents();
  apparkInstance = null;
}

/** 检查是否已初始化 */
export function isApparkInitialized(): boolean {
  return apparkInstance?.initialized ?? false;
}
