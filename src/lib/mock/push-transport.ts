/**
 * E2E Mock Push 传输层（仅 Mock 模式启用）
 *
 * 真实的 web-push 适配器固定走 `https.request`，无法像 Resend 那样用
 * `RESEND_API_URL` 把出网请求重定向到本地捕获端点（`http://` 会直接 TLS 失败）。
 * 因此这里按“保留测试端点”替换传输层：`createPushProvider()` 的配置检查、
 * 载荷构造、指标上报与错误映射全部保持真实，只有底层 HTTP 调用被替换。
 *
 * 端点约定（均以 `https://push-e2e.test/` 为前缀）：
 *   - `/ok`        → 成功（201）
 *   - `/transient` → 瞬时失败（网络错误，可退避重试直至死信）
 *   - `/timeout`   → 瞬时失败（超时，failure_code=timeout）
 *   - `/gone`      → 永久失效（410，撤销本地订阅）
 *
 * 未识别的端点一律失败，避免“忘了注入”被误判为投递成功。
 * 生产与开发非 mock 场景不会构造本传输层。
 */
import type { WebPushTransport } from "@/lib/push-provider";

/** E2E 保留端点基址；spec 用它拼接场景路径 */
export const E2E_PUSH_ENDPOINT_BASE = "https://push-e2e.test";

export const E2E_PUSH_ENDPOINTS = {
  ok: `${E2E_PUSH_ENDPOINT_BASE}/ok`,
  transient: `${E2E_PUSH_ENDPOINT_BASE}/transient`,
  timeout: `${E2E_PUSH_ENDPOINT_BASE}/timeout`,
  gone: `${E2E_PUSH_ENDPOINT_BASE}/gone`,
} as const;

/** 带 HTTP 状态码的错误，供 isPushSubscriptionGone / pushFailureReason 识别 */
function pushServiceError(statusCode: number): Error & { statusCode: number } {
  const error = new Error(`e2e push service responded ${statusCode}`) as Error & {
    statusCode: number;
  };
  error.statusCode = statusCode;
  return error;
}

/** Mock 模式下给 `createPushProvider()` 注入的确定性传输层 */
export function createMockPushTransport(): WebPushTransport {
  return {
    async sendNotification(subscription) {
      const pathname = new URL(subscription.endpoint).pathname;
      switch (pathname) {
        case "/ok":
          return { statusCode: 201 };
        case "/transient":
          throw new Error("e2e injected transient failure");
        case "/timeout":
          throw new Error("e2e injected timeout waiting for push service");
        case "/gone":
          throw pushServiceError(410);
        default:
          throw new Error(`e2e push transport: unexpected endpoint ${pathname}`);
      }
    },
  };
}
