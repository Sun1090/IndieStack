/**
 * Stripe Webhook 纯映射函数
 * 从 webhook route 中抽出，便于单测（Next.js Route 文件只允许导出 HTTP 处理器）
 */
import type { Stripe } from "stripe";

/** Stripe 订阅状态 → 本地 subscriptions.status（与 001 迁移的 CHECK 约束一致） */
export function mapStatus(status: Stripe.Subscription.Status): string {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    default:
      // incomplete / incomplete_expired
      return "inactive";
  }
}

/** Stripe Price ID → 本地 plan 名称 */
export function mapPlan(priceId: string | undefined | null): string {
  // 先判空，避免 priceId 与未配置的环境变量同为 undefined 时误匹配为 pro
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  return "free";
}
