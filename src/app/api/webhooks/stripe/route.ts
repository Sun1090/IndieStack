/**
 * Stripe Webhook API 路由
 * 处理 Stripe 支付事件回调（订阅成功、失败、取消等）
 *
 * POST /api/webhooks/stripe
 * 使用 stripe.webhooks.constructEvent 验证请求签名，
 * 并将订阅状态同步到 subscriptions 表（通过 service_role 客户端写入）。
 */

import { jsonNoStore } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { logApiError } from "@/lib/api-log";
import { ROUTES } from "@/lib/constants";
import { notifyUser } from "@/lib/email-notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeServer } from "@/lib/stripe";
import { mapStatus, mapPlan } from "@/lib/stripe/webhook-mappers";
import {
  claimWebhookEvent,
  finalizeWebhookEvent,
  type WebhookClaim,
} from "@/lib/repositories/webhook-events";
import type { Stripe } from "stripe";
import type { Database } from "@/lib/supabase/database.types";

// 注意：此路由不做 rate limit —— Stripe 事件重试可能触发 429 导致支付状态同步丢失，
// 且限流基于共享内存桶会误伤其他来源；webhook 的安全性由签名验证保证。

type SubscriptionInsert = Database["public"]["Tables"]["subscriptions"]["Insert"];

/** 解析订阅所属团队：优先取 metadata.teamId，否则回退到用户的默认团队 */
async function resolveTeamId(
  teamId: string | undefined | null,
  userId: string | undefined | null,
): Promise<string | null> {
  if (teamId) return teamId;
  if (!userId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.team_id ?? null;
}

/** upsert 订阅记录（依赖 subscriptions.provider_id 唯一索引） */
async function upsertSubscription(subscription: Stripe.Subscription): Promise<void> {
  const teamId = await resolveTeamId(subscription.metadata?.teamId, subscription.metadata?.userId);
  if (!teamId) {
    await logApiError(
      `[Stripe Webhook] 无法解析 team_id，跳过订阅 ${subscription.id}（userId=${subscription.metadata?.userId ?? "unknown"}）`,
      new Error("unresolvable_team"),
    );
    return;
  }

  const firstItem = subscription.items?.data?.[0];
  const priceId = firstItem?.price?.id;
  const record: SubscriptionInsert = {
    team_id: teamId,
    provider: "stripe",
    provider_id: subscription.id,
    status: mapStatus(subscription.status),
    plan: mapPlan(priceId),
    period_start: firstItem?.current_period_start
      ? new Date(firstItem.current_period_start * 1000).toISOString()
      : null,
    period_end: firstItem?.current_period_end
      ? new Date(firstItem.current_period_end * 1000).toISOString()
      : null,
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
  };

  const supabase = createAdminClient();
  const { error } = await supabase.from("subscriptions").upsert(record, {
    onConflict: "provider_id",
  });
  if (error) throw error;
}

/** 将订阅标记为已取消 */
async function markSubscriptionCanceled(providerId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", cancel_at_period_end: false })
    .eq("provider_id", providerId);
  if (error) throw error;
}

/** webhook_events.provider 取值；同一 provider 内 event_id 唯一 */
const WEBHOOK_PROVIDER = "stripe";

/**
 * 执行事件副作用，返回落库状态。
 * 未知事件类型落 skipped + Sentry 上报（同 type 自动分组，需人工评估是否适配）。
 */
async function applyEvent(event: Stripe.Event): Promise<"processed" | "skipped"> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await upsertSubscription(event.data.object as Stripe.Subscription);
      return "processed";

    case "customer.subscription.deleted":
      await markSubscriptionCanceled((event.data.object as Stripe.Subscription).id);
      return "processed";

    case "invoice.payment_succeeded": {
      // 订阅状态由 customer.subscription.* 事件维护，此处通知团队 owner 即可
      const invoice = event.data.object as Stripe.Invoice;
      logger.info(
        `[Stripe Webhook] 付款成功: invoice ${invoice.id}, subscription ${invoice.parent?.subscription_details?.subscription ?? "none"}`,
      );
      await notifyTeamOwner(invoice);
      return "skipped";
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await logApiError(
        `[Stripe Webhook] 付款失败: invoice ${invoice.id}, subscription ${invoice.parent?.subscription_details?.subscription ?? "none"}`,
        new Error("payment_failed"),
      );
      return "skipped";
    }

    default:
      await logApiError(`[Stripe Webhook] 未处理事件: ${event.type}`, new Error("unhandled_event_type"));
      return "skipped";
  }
}

/**
 * POST /api/webhooks/stripe - Handle Stripe webhook events
 */
export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonNoStore({ error: "Missing signature" }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    await logApiError("[Stripe Webhook] 缺少 STRIPE_WEBHOOK_SECRET 环境变量", new Error("misconfigured"));
    return jsonNoStore({ error: "Webhook not configured" }, { status: 500 });
  }

  // 验签：使用 Stripe SDK 校验事件签名与载荷完整性
  let event: Stripe.Event;
  try {
    const stripe = await getStripeServer();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    await logApiError("[Stripe Webhook] 签名验证失败", error);
    return jsonNoStore({ error: "Invalid signature" }, { status: 400 });
  }

  // 幂等占位：Stripe 至少投递一次且会对非 2xx 重试，重复投递必须跳过全部副作用
  const claim = await claimStripeEvent(event);
  if ("response" in claim) return claim.response;

  let status: "processed" | "skipped";
  try {
    status = await applyEvent(event);
  } catch (error) {
    await logApiError("[Stripe Webhook] 处理失败", error);
    await markEventFailed(event.id, error instanceof Error ? error.message : String(error));
    return jsonNoStore({ error: "Webhook handler failed" }, { status: 500 });
  }

  // 副作用已执行：这里的任何失败都**不能**回 500 或标记 failed。
  // status='failed' 会让 Stripe 的下一次重试重新占位并重放副作用（重复订阅写入、重复通知）；
  // 保持 received 最多让 15 分钟租约到期后的一次重试重放，代价远小于必然重放。
  try {
    await finalizeWebhookEvent({ provider: WEBHOOK_PROVIDER, event_id: event.id, status });
  } catch (error) {
    await logApiError("[Stripe Webhook] 事件状态落定失败（副作用已执行，不回 500）", error);
  }
  return jsonNoStore({ received: true });
}

/**
 * 尝试占位；占位成功返回 claim，失败（数据库异常 / 重复投递）直接返回应回的响应。
 * 重复投递回 200 是刻意的：Stripe 收到 2xx 才会停止重试，非 2xx 会继续重放副作用。
 */
async function claimStripeEvent(
  event: Stripe.Event,
): Promise<WebhookClaim | { response: Response }> {
  let claim: WebhookClaim;
  try {
    claim = await claimWebhookEvent({
      provider: WEBHOOK_PROVIDER,
      event_id: event.id,
      event_type: event.type,
    });
  } catch (error) {
    // 占位失败意味着无法证明副作用幂等，回 500 让 Stripe 重试
    await logApiError("[Stripe Webhook] 幂等占位失败", error);
    return { response: jsonNoStore({ error: "Webhook handler failed" }, { status: 500 }) };
  }

  if (claim.outcome === "claimed") return claim;

  logger.info(
    `[Stripe Webhook] 跳过重复投递: ${event.type} ${event.id}（第 ${claim.attempts} 次投递）`,
  );
  return { response: jsonNoStore({ received: true, duplicate: true }) };
}

/** 标记处理失败（status='failed' 允许 Stripe 重试重新占位）；自身失败不影响响应 */
async function markEventFailed(eventId: string, errorMessage: string): Promise<void> {
  try {
    await finalizeWebhookEvent({
      provider: WEBHOOK_PROVIDER,
      event_id: eventId,
      status: "failed",
      error_message: errorMessage,
    });
  } catch (logError) {
    await logApiError("[Stripe Webhook] 事件失败状态写入失败", logError);
  }
}

/**
 * 付款成功时通知团队 owner（经 provider_id 回查订阅归属；失败不影响主流程）
 */
async function notifyTeamOwner(invoice: Stripe.Invoice): Promise<void> {
  try {
    const subscriptionId = invoice.parent?.subscription_details?.subscription;
    if (typeof subscriptionId !== "string") return;
    const admin = createAdminClient();
    const { data: sub } = await admin
      .from("subscriptions")
      .select("team_id")
      .eq("provider_id", subscriptionId)
      .maybeSingle();
    const teamId = (sub as { team_id?: string } | null)?.team_id;
    if (!teamId) return;
    const { data: owner } = await admin
      .from("team_members")
      .select("user_id")
      .eq("team_id", teamId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    const ownerId = (owner as { user_id?: string } | null)?.user_id;
    if (!ownerId) return;
    await notifyUser({
      userId: ownerId,
      type: "payment_succeeded",
      title: "付款成功",
      body: "团队订阅已成功续费。",
      link: ROUTES.dashboardBilling,
      metadata: { team_id: teamId },
    });
  } catch (error) {
    await logApiError("[Stripe Webhook] 付款通知写入失败", error);
  }
}
