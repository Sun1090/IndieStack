/**
 * Supabase 免费版自动恢复（应用侧兜底层）
 *
 * 背景：Supabase 免费版项目连续 7 天无数据库活动会被自动暂停。现有两层防线：
 *   1. 保活：Vercel Cron（`vercel.json`）+ GitHub Actions 每日探测 `/api/health`，
 *      触发一次 Supabase `limit(1)` 查询，让免费版项目不进入 `INACTIVE`。
 *   2. 恢复（后端）：`.github/workflows/supabase-auto-restore.yml` 每日调用
 *      Management API，确认 `INACTIVE` 时执行恢复。
 *
 * 本模块是恢复链路的第二层：GitHub 会在仓库连续 60 天无提交后停用 `schedule`，
 * 因此恢复能力不能只依赖 GitHub Actions。`/api/ops/supabase-restore` 由 Vercel Cron
 * 触发（Vercel Cron 不会因为仓库静默而停用），复用同一套判定：
 * 只有 Management API 明确报告 `status=INACTIVE` 才会写操作。
 *
 * 安全：Management API 令牌仅从服务端环境变量读取，脚本与路由都不打印令牌值。
 */

/** 项目处于中间态时只需等待，不触发恢复（与 scripts/supabase-auto-restore.js 保持一致） */
export const TRANSIENT_PROJECT_STATES = [
  "RESTORING",
  "COMING_UP",
  "UPGRADING",
  "RESTARTING",
  "PAUSING",
  "GOING_DOWN",
  "ACTIVE_UNHEALTHY",
] as const;

/** 需要人工介入、本模块不应尝试恢复的终态 */
export const UNRECOVERABLE_PROJECT_STATES = [
  "REMOVED",
  "INIT_FAILED",
  "RESTORE_FAILED",
] as const;

export type RestoreDecision =
  | "healthy"
  | "paused"
  | "transient"
  | "unrecoverable"
  | "unknown";

/** 路由对外的动作语义；与 HTTP 状态码映射解耦，便于测试 */
export type RestoreAction = "noop" | "restore" | "wait" | "escalate";

export const DEFAULT_SUPABASE_API_BASE = "https://api.supabase.com/v1";
const API_TIMEOUT_MS = 20_000;

/** 把 Management API 的 project status 映射为恢复决策 */
export function classifyProjectStatus(status: string): RestoreDecision {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ACTIVE_HEALTHY") return "healthy";
  if (normalized === "INACTIVE") return "paused";
  if ((UNRECOVERABLE_PROJECT_STATES as readonly string[]).includes(normalized)) {
    return "unrecoverable";
  }
  if ((TRANSIENT_PROJECT_STATES as readonly string[]).includes(normalized)) {
    return "transient";
  }
  return "unknown";
}

/** 决策 → 动作 */
export function restoreActionFor(decision: RestoreDecision): RestoreAction {
  switch (decision) {
    case "healthy":
      return "noop";
    case "paused":
      return "restore";
    case "transient":
      return "wait";
    case "unrecoverable":
    case "unknown":
      return "escalate";
  }
}

/**
 * 解析项目 ref：显式变量优先，其次从 Supabase URL 推断。
 * 只接受 `<ref>.supabase.co` 形态，避免把自建代理地址当成 ref。
 */
export function resolveProjectRef(
  explicit: string | undefined | null,
  supabaseUrl: string | undefined | null,
): string | null {
  const trimmedExplicit = explicit?.trim();
  if (trimmedExplicit) return trimmedExplicit;
  const trimmedUrl = supabaseUrl?.trim();
  if (!trimmedUrl) return null;
  try {
    const host = new URL(trimmedUrl).hostname;
    const match = /^([a-z0-9]{10,32})\.supabase\.(co|in)$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

type HeadersLike = { get(name: string): string | null };

/**
 * cron 调用鉴权：接受 `Authorization: Bearer <CRON_SECRET>`（Vercel Cron 自动附加）
 * 或 `x-cron-secret`（与 `/api/cron/digest` 保持一致）。未配置 secret 时一律拒绝。
 */
export function isCronAuthorized(headers: HeadersLike, expectedSecret: string | undefined): boolean {
  if (!expectedSecret) return false;
  const bearer = headers.get("authorization");
  if (bearer && bearer.startsWith("Bearer ") && bearer.slice(7) === expectedSecret) return true;
  return headers.get("x-cron-secret") === expectedSecret;
}

export type ProjectStatusOptions = {
  ref: string;
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 读取项目当前状态；调用失败时抛错（由调用方决定是否上报） */
export async function readProjectStatus(options: ProjectStatusOptions): Promise<string> {
  const {
    ref,
    token,
    apiBase = DEFAULT_SUPABASE_API_BASE,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
  } = options;
  const response = await fetchWithTimeout(
    `${apiBase}/projects/${ref}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    timeoutMs,
    fetchImpl,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Management API ${response.status}: ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as { status?: unknown } | null;
  const status = typeof body?.status === "string" ? body.status : "";
  return status || "UNKNOWN";
}

/** POST /v1/projects/{ref}/restore —— 无请求体，Bearer 认证；失败时抛错 */
export async function triggerProjectRestore(options: ProjectStatusOptions): Promise<void> {
  const {
    ref,
    token,
    apiBase = DEFAULT_SUPABASE_API_BASE,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
  } = options;
  const response = await fetchWithTimeout(
    `${apiBase}/projects/${ref}/restore`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    timeoutMs,
    fetchImpl,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`restore 失败 ${response.status}: ${detail.slice(0, 200)}`);
  }
}

export type RestoreCycleAction = RestoreAction | "skipped";

export type RestoreCycleResult = {
  /** 建议返回的 HTTP 状态码：200 正常（含无需操作），4xx/5xx 需要人工关注 */
  httpStatus: number;
  body: {
    ok: boolean;
    action: RestoreCycleAction;
    projectStatus?: string;
    reason?: string;
    checkedAt: string;
  };
};

export type RestoreCycleOptions = {
  ref: string | null;
  token: string | undefined;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  /** 生产环境缺失配置时必须显式失败，避免兜底层静默失效 */
  isProduction?: boolean;
  now?: () => Date;
};

/**
 * 执行一轮检查：读到 `INACTIVE` 才恢复；中间态只报告；未知/不可恢复状态需要人工介入。
 * 返回值直接对应路由响应，副作用（日志/指标）由路由注入的回调完成。
 */
export async function runRestoreCycle(
  options: RestoreCycleOptions,
  hooks: {
    onMetric: (action: RestoreCycleAction, projectStatus: string | undefined) => void;
    onError: (scope: string, error: unknown) => Promise<void>;
    onInfo: (message: string, data?: Record<string, unknown>) => void;
    onWarn: (message: string, data?: Record<string, unknown>) => void;
  },
): Promise<RestoreCycleResult> {
  const { ref, token, apiBase, fetchImpl, isProduction = false } = options;
  const now = options.now ?? (() => new Date());
  const checkedAt = () => now().toISOString();

  if (!ref || !token) {
    const missing = [
      !ref && "SUPABASE_PROJECT_REF/NEXT_PUBLIC_SUPABASE_URL",
      !token && "SUPABASE_ACCESS_TOKEN",
    ]
      .filter(Boolean)
      .join(", ");
    hooks.onWarn("[Ops] Supabase auto-restore skipped: missing configuration", { missing });
    return {
      httpStatus: isProduction ? 503 : 200,
      body: { ok: !isProduction, action: "skipped", reason: missing, checkedAt: checkedAt() },
    };
  }

  const requestOptions = { ref, token, apiBase, fetchImpl };
  let status: string;
  try {
    status = await readProjectStatus(requestOptions);
  } catch (error) {
    await hooks.onError("[Ops] Supabase project status lookup failed", error);
    return {
      httpStatus: 502,
      body: { ok: false, action: "escalate", reason: "status-lookup-failed", checkedAt: checkedAt() },
    };
  }

  const action = restoreActionFor(classifyProjectStatus(status));
  hooks.onMetric(action, status);

  if (action === "restore") {
    try {
      await triggerProjectRestore(requestOptions);
    } catch (error) {
      await hooks.onError("[Ops] Supabase restore failed", error);
      return {
        httpStatus: 502,
        body: { ok: false, action: "escalate", projectStatus: status, reason: "restore-failed", checkedAt: checkedAt() },
      };
    }
    hooks.onInfo("[Ops] Supabase restore triggered", { projectStatus: status });
    return { httpStatus: 200, body: { ok: true, action, projectStatus: status, checkedAt: checkedAt() } };
  }

  if (action === "escalate") {
    await hooks.onError(
      "[Ops] Supabase project needs manual intervention",
      new Error(`supabase_project_status_${status}`),
    );
    return {
      httpStatus: 503,
      body: {
        ok: false,
        action,
        projectStatus: status,
        reason: `unexpected-status:${status}`,
        checkedAt: checkedAt(),
      },
    };
  }

  return { httpStatus: 200, body: { ok: true, action, projectStatus: status, checkedAt: checkedAt() } };
}
