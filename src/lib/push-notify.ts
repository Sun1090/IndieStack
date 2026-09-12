/**
 * Immediate Web Push delivery for a single in-app notification.
 *
 * v0.8.0：投递结果持久化到 `push_delivery_attempts`（每个端点一行）。
 * 成功记 `sent`；瞬时失败记 `pending` 并按指数退避留待 cron 重试；
 * HTTP 404/410 记 `dead` 并撤销本地订阅。持久化失败只记日志，
 * 绝不阻断站内通知或邮件通道。
 */
import {
  isPushSubscriptionGone,
  pushFailureReason,
  type PushMessage,
  type PushProvider,
} from "@/lib/push-provider";
import { createPushProvider } from "@/lib/push-provider";
import { shouldSendPush, type EmailPreferences } from "@/lib/notification-prefs";
import {
  listPushSubscriptions,
  removePushSubscription,
  type PushSubscriptionRecord,
} from "@/lib/repositories/push-subscriptions";
import {
  enqueuePushDeliveryAttempts,
  markPushDeliveryDead,
  markPushDeliveryRetry,
  markPushDeliverySent,
  pushBackoffMs,
} from "@/lib/repositories/push-delivery-attempts";
import { logApiError } from "@/lib/api-log";
import { recordMetric } from "@/lib/metrics";
import type { MetricOptions } from "@/lib/metrics";
import type { NotificationType } from "@/lib/repositories/notifications";

export interface PushNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  idempotencyKey?: string;
  /** 站内通知 id；存在时启用持久化重试队列，缺失则回退为即时 best-effort */
  notificationId?: string | null;
}

export interface PushDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  /** push service 报告永久失效（HTTP 404/410）的端点数 */
  revoked: number;
  /** 直接进入死信的端点数（含 revoked） */
  dead: number;
  skipped: boolean;
}

export interface PushDeliveryDependencies {
  createProvider?: () => PushProvider;
  listSubscriptions?: (userId: string) => Promise<PushSubscriptionRecord[]>;
  removeSubscription?: (userId: string, endpoint: string) => Promise<void>;
  reportError?: (message: string, error: unknown) => Promise<void>;
  enqueueAttempts?: typeof enqueuePushDeliveryAttempts;
  markSent?: typeof markPushDeliverySent;
  markRetry?: typeof markPushDeliveryRetry;
  markDead?: typeof markPushDeliveryDead;
  recordMetricFn?: typeof recordMetric;
  now?: () => Date;
}

type ReportError = (message: string, error: unknown) => Promise<void>;

interface DeliveryContext {
  userId: string;
  notificationId: string | null;
  persist: boolean;
  provider: PushProvider;
  removeSubscription: (userId: string, endpoint: string) => Promise<void>;
  markSent: typeof markPushDeliverySent;
  markRetry: typeof markPushDeliveryRetry;
  markDead: typeof markPushDeliveryDead;
  reportError: ReportError;
  emitMetric: (name: string, value: number, options?: MetricOptions) => boolean;
  now: () => Date;
}

function messageFor(input: PushNotificationInput, subscription: PushSubscriptionRecord): PushMessage {
  return {
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
    title: input.title,
    body: input.body,
    link: input.link,
    tag: input.idempotencyKey,
  };
}

function failureMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function writeReceipt(run: () => Promise<void>, context: DeliveryContext, label: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    await context.reportError(label, error);
  }
}

/** 端点永久失效：计数、清理本地订阅、写死信回执 */
async function handleGoneEndpoint(
  subscription: PushSubscriptionRecord,
  error: unknown,
  context: DeliveryContext,
): Promise<void> {
  context.emitMetric("push.endpoint.revoked", 1, {
    unit: "count",
    attributes: { reason: "subscription-gone", channel: "push" },
  });
  try {
    await context.removeSubscription(context.userId, subscription.endpoint);
  } catch (removeError) {
    await context.reportError("[Push Notify] 失效订阅清理失败", removeError);
  }
  if (context.persist && context.notificationId) {
    const notificationId = context.notificationId;
    await writeReceipt(
      () =>
        context.markDead(
          notificationId,
          subscription.endpoint,
          { attemptCount: 1, failureCode: "subscription-gone", error: failureMessage(error) },
          context.now(),
        ),
      context,
      "[Push Notify] 死信回执写入失败",
    );
  }
  await context.reportError("[Push Notify] 端点失效，已撤销订阅", error);
}

/** 瞬时失败：写退避重试回执，由 cron worker 继续投递 */
async function handleTransientFailure(
  subscription: PushSubscriptionRecord,
  error: unknown,
  context: DeliveryContext,
): Promise<void> {
  await context.reportError("[Push Notify] 投递失败（留待重试）", error);
  if (!context.persist || !context.notificationId) return;
  const notificationId = context.notificationId;
  const attemptAt = context.now();
  await writeReceipt(
    () =>
      context.markRetry(
        notificationId,
        subscription.endpoint,
        {
          attemptCount: 1,
          nextAttemptAt: new Date(attemptAt.getTime() + pushBackoffMs(1)),
          failureCode: pushFailureReason(error),
          error: failureMessage(error),
        },
        attemptAt,
      ),
    context,
    "[Push Notify] 重试回执写入失败",
  );
}

/**
 * 单个端点的即时投递。返回统一的结果分类，主循环只做计数。
 * 即时投递永远是该 (notification, endpoint) 行的第 1 次尝试；
 * 后续次数由重试 worker 基于库内计数累加。
 */
async function deliverToSubscription(
  input: PushNotificationInput,
  subscription: PushSubscriptionRecord,
  context: DeliveryContext,
): Promise<"sent" | "failed" | "revoked"> {
  try {
    await context.provider.send(messageFor(input, subscription));
    if (context.persist && context.notificationId) {
      const notificationId = context.notificationId;
      await writeReceipt(
        () => context.markSent(notificationId, subscription.endpoint, 1, context.now()),
        context,
        "[Push Notify] 投递回执写入失败",
      );
    }
    return "sent";
  } catch (error) {
    if (isPushSubscriptionGone(error)) {
      await handleGoneEndpoint(subscription, error, context);
      return "revoked";
    }
    await handleTransientFailure(subscription, error, context);
    return "failed";
  }
}

/** 组装投递上下文（依赖注入默认值集中在此，保持主流程复杂度可控） */
function resolveContext(
  input: PushNotificationInput,
  dependencies: PushDeliveryDependencies,
  provider: PushProvider,
): DeliveryContext {
  const notificationId = input.notificationId ?? null;
  return {
    userId: input.userId,
    notificationId,
    persist: Boolean(notificationId),
    provider,
    removeSubscription: dependencies.removeSubscription ?? removePushSubscription,
    markSent: dependencies.markSent ?? markPushDeliverySent,
    markRetry: dependencies.markRetry ?? markPushDeliveryRetry,
    markDead: dependencies.markDead ?? markPushDeliveryDead,
    reportError: dependencies.reportError ?? logApiError,
    emitMetric: dependencies.recordMetricFn ?? recordMetric,
    now: dependencies.now ?? (() => new Date()),
  };
}

/** 发送前入队，保证进程中途崩溃也能留下可重试行；写入失败降级为即时 best-effort */
async function enqueueBeforeSend(
  userId: string,
  subscriptions: PushSubscriptionRecord[],
  context: DeliveryContext,
  dependencies: PushDeliveryDependencies,
): Promise<void> {
  if (!context.notificationId) return;
  try {
    await (dependencies.enqueueAttempts ?? enqueuePushDeliveryAttempts)(
      context.notificationId,
      userId,
      subscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        endpoint: subscription.endpoint,
      })),
      context.now(),
    );
  } catch (error) {
    context.persist = false;
    await context.reportError("[Push Notify] 投递队列写入失败", error);
  }
}

/**
 * Push is best-effort at the event boundary; failed deliveries are queued for
 * retry and never block the in-app notification or the email channel. HTTP
 * 404/410 means the browser endpoint is permanently invalid, so it is removed
 * immediately and dead-lettered instead of being retried.
 */
export async function deliverPushNotification(
  input: PushNotificationInput,
  preferences: EmailPreferences,
  dependencies: PushDeliveryDependencies = {},
): Promise<PushDeliveryResult> {
  const result: PushDeliveryResult = {
    attempted: 0,
    sent: 0,
    failed: 0,
    revoked: 0,
    dead: 0,
    skipped: false,
  };
  if (!shouldSendPush(preferences, input.type)) return { ...result, skipped: true };

  const provider = (dependencies.createProvider ?? createPushProvider)();
  const subscriptions = await (dependencies.listSubscriptions ?? listPushSubscriptions)(input.userId);
  if (subscriptions.length === 0) return { ...result, skipped: true };
  if (!provider.configured) {
    throw new Error("Web Push provider is not configured");
  }

  const context = resolveContext(input, dependencies, provider);
  await enqueueBeforeSend(input.userId, subscriptions, context, dependencies);

  for (const subscription of subscriptions) {
    result.attempted += 1;
    const outcome = await deliverToSubscription(input, subscription, context);
    if (outcome === "sent") result.sent += 1;
    if (outcome === "failed") result.failed += 1;
    if (outcome === "revoked") {
      result.revoked += 1;
      result.dead += 1;
    }
  }

  return result;
}
