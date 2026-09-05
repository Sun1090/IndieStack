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
import { upsertWebhookEvent } from "@/lib/repositories/webhook-events";
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

  try {
    let status: "processed" | "skipped" = "processed";
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        await upsertSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      case "customer.subscription.deleted": {
        await markSubscriptionCanceled((event.data.object as Stripe.Subscription).id);
        break;
      }

      case "invoice.payment_succeeded": {
        // 订阅状态由 customer.subscription.* 事件维护，此处通知团队 owner 即可
        const invoice = event.data.object as Stripe.Invoice;
        logger.info(
          `[Stripe Webhook] 付款成功: invoice ${invoice.id}, subscription ${invoice.parent?.subscription_details?.subscription ?? "none"}`,
        );
        await notifyTeamOwner(invoice);
        status = "skipped";
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await logApiError(
          `[Stripe Webhook] 付款失败: invoice ${invoice.id}, subscription ${invoice.parent?.subscription_details?.subscription ?? "none"}`,
          new Error("payment_failed"),
        );
        status = "skipped";
        break;
      }

      default:
        // 未知事件类型：落表 skipped + Sentry 上报（同 type 自动分组，需人工评估是否适配）
        await logApiError(`[Stripe Webhook] 未处理事件: ${event.type}`, new Error("unhandled_event_type"));
        status = "skipped";
    }

    await recordWebhookEvent(event.id, event.type, status);
    return jsonNoStore({ received: true });
  } catch (error) {
    await logApiError("[Stripe Webhook] 处理失败", error);
    await recordWebhookEvent(
      event.id,
      event.type,
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    return jsonNoStore({ error: "Webhook handler failed" }, { status: 500 });
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

/** 将事件处理结果写入 webhook_events 日志表（失败不影响主流程） */
async function recordWebhookEvent(
  eventId: string,
  eventType: string,
  status: "processed" | "skipped" | "failed",
  errorMessage?: string,
): Promise<void> {
  try {
    await upsertWebhookEvent({
      provider: "stripe",
      event_id: eventId,
      event_type: eventType,
      status,
      error_message: errorMessage ?? null,
    });
  } catch (logError) {
    await logApiError("[Stripe Webhook] 事件日志写入失败", logError);
  }
}
