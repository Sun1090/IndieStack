/**
 * Stripe 支付集成模块
 * 提供前端 Stripe 客户端初始化、结账会话创建、订阅管理等功能
 *
 * 客户端使用：
 *   import { getStripe, redirectToCheckout } from "@/lib/stripe";
 *   await redirectToCheckout("price_pro_monthly");
 *
 * 服务端使用：
 *   import { createCheckoutSession, createPortalSession } from "@/lib/stripe";
 *   const { url } = await createCheckoutSession(priceId);
 */

import type { Stripe } from "@stripe/stripe-js";
import { flushEvents, trackEvent } from "@/lib/appark";

export interface CheckoutSessionParams {
  customerId?: string;
  customerEmail?: string;
  userId?: string;
  teamId?: string;
  successUrl?: string;
  cancelUrl?: string;
  allowPromotionCodes?: boolean;
  trialDays?: number;
  metadata?: Record<string, string>;
  /** Stripe 幂等键（防双击/重试建出多个 session） */
  idempotencyKey?: string;
}

export type SubscriptionStatus =
  "active" | "incomplete" | "incomplete_expired" | "past_due" | "canceled" | "unpaid" | "trialing";

export interface SubscriptionInfo {
  id: string;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  isTrialing: boolean;
  isCanceled: boolean;
  planName: string;
  planAmount: number;
  planCurrency: string;
  planInterval: "month" | "year";
}

let stripePromise: Promise<Stripe | null> | null = null;

/** 获取 Stripe 客户端实例（单例模式） */
async function getStripe(): Promise<Stripe | null> {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Stripe] 未配置 NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
    }
    return null;
  }
  if (!stripePromise) {
    const { loadStripe } = await import("@stripe/stripe-js");
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

/**
 * 跳转到 Stripe Checkout 页面（客户端使用）
 * 通过服务端 API 创建结账会话，然后直接跳转
 */
async function redirectToCheckout(
  priceId: string,
  params?: Omit<CheckoutSessionParams, "customerId">,
): Promise<string> {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceId, ...params }),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error ?? "checkoutError");
  }

  const { url } = await response.json();
  if (!url) throw new Error("未获取到结账 URL");
  window.location.href = url;
  return url;
}

/** 创建 Stripe Checkout Session（服务端使用） */
async function createCheckoutSession(
  priceId: string,
  params?: CheckoutSessionParams,
): Promise<{ url: string | null; sessionId: string }> {
  const stripe = await getStripeServer();
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: params?.customerId,
      customer_email: params?.customerEmail,
      client_reference_id: params?.userId,
      success_url:
        params?.successUrl ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing?success=true`,
      cancel_url:
        params?.cancelUrl ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing?canceled=true`,
      allow_promotion_codes: params?.allowPromotionCodes ?? true,
      subscription_data: {
        ...(params?.trialDays ? { trial_period_days: params.trialDays } : {}),
        metadata: { userId: params?.userId ?? "", teamId: params?.teamId ?? "", ...params?.metadata },
      },
    },
    params?.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined,
  );
  if (!session.url && !session.id) {
    throw new Error("创建 Stripe 结账会话失败");
  }
  // APM 关键流程埋点（C01）：旁路 no-op（未启用 Appark 时）
  trackEvent("checkout.session_created", {
    userId: params?.userId ?? null,
    teamId: params?.teamId ?? null,
  });
  // 埋点进的是 `src/lib/appark.ts` 的**进程内**队列，而队列不会自己出去——必须有人调 flushEvents。
  // 全仓此前唯一的 flush 调用点在 cron 那个函数里，而它在 Vercel 上是**另一个** serverless 实例，
  // 所以这条结账埋点从来没离开过本进程（ADR-011 写的「关键流程均在请求尾部主动 flush」在这里没落地）。
  // 不 await：那是把一次第三方收集端的往返塞进跳 Stripe 的路上，而 flushEvents 自己吞掉所有异常。
  void flushEvents();
  return { url: session.url, sessionId: session.id };
}

/** 创建 Customer Portal 会话（管理订阅/发票/支付方式） */
async function createPortalSession(customerId: string, returnUrl?: string): Promise<string> {
  const stripe = await getStripeServer();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url:
      returnUrl ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing`,
  });
  return session.url;
}

/** 从 Stripe 订阅对象提取公共字段（降低主函数圈复杂度） */
function toSubscriptionInfo(subscription: any): SubscriptionInfo {
  const item = subscription?.items?.data?.[0];
  const plan = item?.price;
  const status = (subscription?.status ?? "incomplete") as SubscriptionStatus;

  const info: SubscriptionInfo = {
    id: subscription?.id ?? "",
    status,
    currentPeriodStart: subscription?.current_period_start ?? 0,
    currentPeriodEnd: subscription?.current_period_end ?? 0,
    isTrialing: status === "trialing",
    isCanceled: Boolean(subscription?.cancel_at_period_end) || status === "canceled",
    planName: "Unknown",
    planAmount: 0,
    planCurrency: "usd",
    planInterval: "month",
  };

  if (!plan) return info;

  info.planName =
    plan.nickname ?? (typeof plan.product === "string" ? plan.product : plan.product?.toString()) ?? "Unknown";
  info.planAmount = plan.unit_amount ?? 0;
  info.planCurrency = plan.currency ?? "usd";
  info.planInterval = plan.recurring?.interval === "year" ? "year" : "month";
  return info;
}

/** 获取订阅信息 */
async function getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  const stripe = await getStripeServer();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return toSubscriptionInfo(subscription);
}

/** 取消订阅（周期结束时停止续费） */
async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = await getStripeServer();
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

/** 延迟加载 Stripe 服务端 SDK（服务端专用） */
export async function getStripeServer() {
  const Stripe = (await import("stripe")).default;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe 未配置，请设置 STRIPE_SECRET_KEY");
  // 不显式指定 apiVersion：默认使用 SDK 固定的版本，升级 SDK 时类型与行为保持一致
  return new Stripe(secretKey);
}

/** 检查 Stripe 配置状态 */
export function isStripeConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_SECRET_KEY);
}

export {
  getStripe,
  redirectToCheckout,
  createCheckoutSession,
  createPortalSession,
  getSubscription,
  cancelSubscription,
};
