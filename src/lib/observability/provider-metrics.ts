/**
 * Provider 降级 / 回退指标契约（v0.6.0 E06）
 *
 * 「回退」= 运行期实际提供服务的实现与运维声明的意图不一致（或声明的 provider
 * 不可用被旁路关闭）。它有两个相反的失效模式，本模块各解决一个：
 *
 *   1. **静默降级**：OSS 四项变量只填了一部分，代码安静地继续用 Supabase，
 *      业务不报错、日志不显眼，运维却以为流量已经走 OSS。
 *   2. **噪声降级**：每次请求都上报同一条降级，把一次配置问题放大成流量级告警。
 *
 * 因此指标名与维度取值集中在这里，去重以「缺失变量签名」为单位：同一签名在单个
 * 进程内只上报一次；签名变化（部分补齐）重新上报；配置恢复到完整后重置，让下一次
 * 真正的新降级仍然可见。`oss-not-configured`（四项全空）是默认驱动而不是降级，
 * 不产生任何回退告警——没打算用 OSS 的部署不该被打扰。
 */
import { recordMetric } from "@/lib/metrics";
import type { StorageProviderName } from "@/lib/observability/storage-metrics";

/** 运行期降级计数。维度：provider（实际提供服务的实现）、reason、missing。 */
export const PROVIDER_FALLBACK_METRIC = "provider.fallback";

/** 降级原因取值集合；新增取值必须同步运维文档与告警规则。 */
export const PROVIDER_FALLBACK_REASONS = ["oss-incomplete"] as const;
export type ProviderFallbackReason = (typeof PROVIDER_FALLBACK_REASONS)[number];

/** OSS 四项变量只配置了一部分：运行期回退 Supabase Storage。 */
export const OSS_INCOMPLETE_REASON: ProviderFallbackReason = "oss-incomplete";

/** 未配置的 provider 被旁路关闭；与 Web Push 的 `push.send.failed` 复用同一取值。 */
export const NOT_CONFIGURED_REASON = "not-configured";

/**
 * 缺失变量名的去重签名。排序后再拼接，使签名只取决于「缺了哪些变量」，
 * 与调用方传入顺序、配置清单书写顺序无关。
 */
export function providerFallbackSignature(missing: readonly string[]): string {
  return [...missing].sort().join(",");
}

/** 上报一次降级：`missing` 只含变量名，绝不包含凭据值。 */
export function recordProviderFallback(input: {
  provider: StorageProviderName;
  reason: ProviderFallbackReason;
  missing: readonly string[];
}): boolean {
  return recordMetric(PROVIDER_FALLBACK_METRIC, 1, {
    attributes: {
      provider: input.provider,
      reason: input.reason,
      missing: providerFallbackSignature(input.missing),
    },
  });
}

export interface ProviderFallbackGate {
  /** `null` 表示当前没有降级（配置完整或未启用），会重置状态并返回 false。 */
  shouldReport(signature: string | null): boolean;
  /** 忘记上次签名；配置热重载或测试需要重新观察降级时使用。 */
  reset(): void;
}

/** 进程内降级去重闸门（状态是单个签名，不随 provider 数量增长）。 */
export function createProviderFallbackGate(): ProviderFallbackGate {
  let lastSignature: string | null = null;
  return {
    shouldReport(signature) {
      if (signature === null) {
        lastSignature = null;
        return false;
      }
      if (signature === lastSignature) return false;
      lastSignature = signature;
      return true;
    },
    reset() {
      lastSignature = null;
    },
  };
}
