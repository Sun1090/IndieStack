/**
 * 请求链路追踪 ID 的纯契约（E02）。
 *
 * 该模块刻意不依赖 `next/headers`，因此既能被 Edge middleware（`src/proxy.ts`）
 * 引用，也能被运行时节工具与门禁脚本复用：
 *
 * - `TRACE_HEADER`：跨服务传递的请求头名，单一事实源；
 * - `normalizeTraceId`：只接受短、可打印、无分隔符歧义的 token，拒绝换行/超长/空白，
 *   避免上游伪造的 header 污染日志行；
 * - `resolveTraceId`：透传合法上游 ID，否则生成新 ID，保证每个请求都有 trace-id。
 */

/** 请求级 trace-id 的 HTTP header 名。 */
export const TRACE_HEADER = "x-request-id";

/** trace-id 长度上限：足够容纳 UUID/W3C traceparent 片段，同时阻止超长 header 注入日志。 */
export const MAX_TRACE_ID_LENGTH = 128;

/** 允许的字符集：字母、数字与 `. _ : -`（覆盖 UUID、ULID、OpenTelemetry 常见格式）。 */
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/** 归一化上游 trace-id；非法值返回 null（调用方据此生成新 ID）。 */
export function normalizeTraceId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TRACE_ID_LENGTH) return null;
  if (!TRACE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function fallbackTraceId(): string {
  let hex = "";
  while (hex.length < 32) hex += Math.floor(Math.random() * 16).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** 生成新的 trace-id（优先 WebCrypto，缺失时退化为 UUID 形状的随机串）。 */
export function createTraceId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  return fallbackTraceId();
}

/** 透传合法上游 trace-id，否则生成新 ID；保证返回值一定可安全写入日志与响应头。 */
export function resolveTraceId(
  raw: string | null | undefined,
  generate: () => string = createTraceId,
): string {
  return normalizeTraceId(raw) ?? generate();
}
