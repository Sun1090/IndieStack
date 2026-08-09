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

export interface CheckoutSessionParams {
  customerId?: string;
  customerEmail?: string;
  userId?: string;
  successUrl?: string;
  cancelUrl?: string;
  allowPromotionCodes?: boolean;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export type SubscriptionStatus =
  | "active" | "incomplete" | "incomplete_expired" | "past_due"
  | "canceled" | "unpaid" | "trialing";

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
  params?: Omit<CheckoutSessionParams, "customerId">
): Promise<string> {
  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priceId, ...params }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message ?? "创建结账会话失败");
  }

  const { url } = await response.json();
  if (!url) throw new Error("未获取到结账 URL");
  window.location.href = url;
  return url;
}

/** 创建 Stripe Checkout Session（服务端使用） */
async function createCheckoutSession(
  priceId: string,
  params?: CheckoutSessionParams
): Promise<{ url: string | null; sessionId: string }> {
  const stripe = await importStripeServer();
  const session = await stripe.checkout.sessions.create({
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
      metadata: { userId: params?.userId ?? "", ...params?.metadata },
    },
  });
  if (!session.url && !session.id) {
    throw new Error("创建 Stripe 结账会话失败");
  }
  return { url: session.url, sessionId: session.id };
}

/** 创建 Customer Portal 会话（管理订阅/发票/支付方式） */
async function createPortalSession(customerId: string, returnUrl?: string): Promise<string> {
  const stripe = await importStripeServer();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url:
      returnUrl ??
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard/billing`,
  });
  return session.url;
}

/** 获取订阅信息 */
async function getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
  const stripe = await importStripeServer();
  const subscription = (await stripe.subscriptions.retrieve(subscriptionId)) as any;
  if (!subscription || !subscription.items?.data?.[0]?.price) {
    return {
      id: subscription?.id ?? "",
      status: (subscription?.status ?? "incomplete") as SubscriptionStatus,
      currentPeriodStart: subscription?.current_period_start ?? 0,
      currentPeriodEnd: subscription?.current_period_end ?? 0,
      isTrialing: subscription?.status === "trialing",
      isCanceled: subscription?.cancel_at_period_end || subscription?.status === "canceled",
      planName: "Unknown",
      planAmount: 0,
      planCurrency: "usd",
      planInterval: "month",
    };
  }
  const plan = subscription.items.data[0].price;
  return {
    id: subscription.id,
    status: subscription.status as SubscriptionStatus,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    isTrialing: subscription.status === "trialing",
    isCanceled: subscription.cancel_at_period_end || subscription.status === "canceled",
    planName: plan.nickname ?? (typeof plan.product === "string" ? plan.product : plan.product?.toString()) ?? "Unknown",
    planAmount: plan.unit_amount ?? 0,
    planCurrency: plan.currency ?? "usd",
    planInterval: plan.recurring?.interval === "year" ? "year" : "month",
  };
}

/** 取消订阅（周期结束时停止续费） */
async function cancelSubscription(subscriptionId: string): Promise<void> {
  const stripe = await importStripeServer();
  await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
}

/** 延迟加载 Stripe 服务端 SDK */
async function importStripeServer() {
  const Stripe = (await import("stripe")).default;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Stripe 未配置，请设置 STRIPE_SECRET_KEY");
  return new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
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
