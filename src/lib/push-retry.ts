/**
 * Web Push 重试 Worker 引擎（v0.8.0）
 *
 * 从 `push_delivery_attempts` 拉取到期的 pending 行，按端点重试投递：
 *   - 成功            → sent
 *   - 瞬时失败        → 累加 attempt_count，按指数退避重排；达到上限转死信
 *   - 订阅不存在      → dead（subscription-missing）并计入失效端点
 *   - HTTP 404/410    → dead（subscription-gone）并撤销本地订阅
 *   - 用户关闭 Push    → dead（push-disabled，不再打扰已退订用户）
 *
 * 依赖以参数注入，便于单测在没有真实数据库 / push service 的情况下覆盖全部分支。
 */
import { logApiError } from "@/lib/api-log";
import { recordMetric, type MetricOptions } from "@/lib/metrics";
import { shouldSendPush, type EmailPreferences } from "@/lib/notification-prefs";
import {
  isPushSubscriptionGone,
  pushFailureReason,
  type PushProvider,
} from "@/lib/push-provider";
import {
  PUSH_MAX_ATTEMPTS,
  markPushDeliveryDead,
  markPushDeliveryRetry,
  markPushDeliverySent,
  pushBackoffMs,
  type PushDeliveryAttempt,
} from "@/lib/repositories/push-delivery-attempts";
import type { Notification, NotificationType } from "@/lib/repositories/notifications";
import type { PushSubscriptionRecord } from "@/lib/repositories/push-subscriptions";

/** 单次 cron 拉取上限，避免超过函数执行预算 */
export const PUSH_RETRY_BATCH_SIZE = 50;

export type PushRetryOutcome = "sent" | "retried" | "dead" | "revoked";

export interface PushRetryResult {
  pulled: number;
  sent: number;
  retried: number;
  dead: number;
  revoked: number;
}

export interface PushRetryDependencies {
  createProvider: () => PushProvider;
  listDue: (limit: number, now: Date) => Promise<PushDeliveryAttempt[]>;
  listNotifications: (ids: string[]) => Promise<Notification[]>;
  getSubscription: (id: string) => Promise<PushSubscriptionRecord | null>;
  getNotificationSettings: (userIds: string[]) => Promise<Map<string, unknown>>;
  markSent: typeof markPushDeliverySent;
  markRetry: typeof markPushDeliveryRetry;
  markDead: typeof markPushDeliveryDead;
  removeSubscription: (userId: string, endpoint: string) => Promise<void>;
  recordMetric?: (name: string, value: number, options?: MetricOptions) => boolean;
  reportError?: (message: string, error: unknown) => Promise<void>;
  now?: () => Date;
  batchSize?: number;
}

interface RetryContext {
  dependencies: PushRetryDependencies;
  provider: PushProvider;
  notifications: Map<string, Notification>;
  settingsByUser: Map<string, unknown>;
  subscriptions: Map<string, PushSubscriptionRecord | null>;
  emitMetric: (name: string, value: number, options?: MetricOptions) => boolean;
  reportError: (message: string, error: unknown) => Promise<void>;
  now: () => Date;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function asPreferences(settings: unknown): EmailPreferences {
  return (settings ?? {}) as EmailPreferences;
}

/** 批量补齐通知内容、用户偏好与订阅凭据，避免逐行查询 */
async function loadContext(
  dependencies: PushRetryDependencies,
  due: PushDeliveryAttempt[],
): Promise<RetryContext> {
  const provider = dependencies.createProvider();
  if (!provider.configured) {
    // 部署漏配 VAPID 时快速失败，好过把整条队列静默转成死信
    throw new Error("Web Push provider is not configured");
  }

  const notifications = new Map(
    (await dependencies.listNotifications(
      Array.from(new Set(due.map((attempt) => attempt.notification_id))),
    )).map((notification) => [notification.id, notification]),
  );
  const settingsByUser = await dependencies.getNotificationSettings(
    Array.from(new Set(due.map((attempt) => attempt.user_id))),
  );
  const subscriptions = new Map<string, PushSubscriptionRecord | null>();
  for (const attempt of due) {
    if (attempt.push_subscription_id && !subscriptions.has(attempt.push_subscription_id)) {
      subscriptions.set(
        attempt.push_subscription_id,
        await dependencies.getSubscription(attempt.push_subscription_id),
      );
    }
  }

  return {
    dependencies,
    provider,
    notifications,
    settingsByUser,
    subscriptions,
    emitMetric: dependencies.recordMetric ?? recordMetric,
    reportError: dependencies.reportError ?? logApiError,
    now: dependencies.now ?? (() => new Date()),
  };
}

function attemptCountFor(attempt: PushDeliveryAttempt): number {
  return attempt.attempt_count + 1;
}

/** 统一的死信回执 + 计数指标，避免每条分支重复 try/catch */
async function finishDead(
  context: RetryContext,
  attempt: PushDeliveryAttempt,
  input: { attemptCount: number; failureCode: string; error: string },
  at: Date,
): Promise<void> {
  context.emitMetric("push.delivery.dead", 1, {
    unit: "count",
    attributes: { reason: input.failureCode, channel: "push" },
  });
  try {
    await context.dependencies.markDead(
      attempt.notification_id,
      attempt.endpoint,
      { attemptCount: input.attemptCount, failureCode: input.failureCode, error: input.error },
      at,
    );
  } catch (error) {
    await context.reportError("[Push Retry] 死信回执写入失败", error);
  }
}

/** 端点被 push service 判为永久失效：撤销本地订阅后写死信 */
async function handleGoneEndpoint(
  context: RetryContext,
  attempt: PushDeliveryAttempt,
  error: unknown,
  attemptCount: number,
  at: Date,
): Promise<void> {
  context.emitMetric("push.endpoint.revoked", 1, {
    unit: "count",
    attributes: { reason: "subscription-gone", channel: "push" },
  });
  try {
    await context.dependencies.removeSubscription(attempt.user_id, attempt.endpoint);
  } catch (removeError) {
    await context.reportError("[Push Retry] 失效订阅清理失败", removeError);
  }
  await finishDead(
    context,
    attempt,
    { attemptCount, failureCode: "subscription-gone", error: failureMessage(error) },
    at,
  );
}

/** 瞬时失败：未达上限则退避重排，达到上限转死信 */
async function scheduleRetry(
  context: RetryContext,
  attempt: PushDeliveryAttempt,
  error: unknown,
  attemptCount: number,
  at: Date,
): Promise<PushRetryOutcome> {
  if (attemptCount >= PUSH_MAX_ATTEMPTS) {
    await finishDead(
      context,
      attempt,
      { attemptCount, failureCode: "max-attempts", error: failureMessage(error) },
      at,
    );
    return "dead";
  }

  try {
    await context.dependencies.markRetry(
      attempt.notification_id,
      attempt.endpoint,
      {
        attemptCount,
        nextAttemptAt: new Date(at.getTime() + pushBackoffMs(attemptCount)),
        failureCode: pushFailureReason(error),
        error: failureMessage(error),
      },
      at,
    );
  } catch (markError) {
    await context.reportError("[Push Retry] 重试回执写入失败", markError);
  }
  await context.reportError("[Push Retry] 投递失败，已安排重试", error);
  return "retried";
}

type Preflight =
  | { ok: true; notification: Notification; subscription: PushSubscriptionRecord }
  | { ok: false; revoked: boolean };

/**
 * 重试尝试的前置校验：补齐通知内容与订阅凭据。
 * 任一不可恢复条件都会直接落死信，返回 `{ ok: false }` 让调用方计数。
 */
async function preflight(
  context: RetryContext,
  attempt: PushDeliveryAttempt,
  attemptCount: number,
  at: Date,
): Promise<Preflight> {
  const notification = context.notifications.get(attempt.notification_id);
  if (!notification) {
    await finishDead(context, attempt, {
      attemptCount,
      failureCode: "notification-missing",
      error: "notification row missing",
    }, at);
    return { ok: false, revoked: false };
  }

  if (!shouldSendPush(asPreferences(context.settingsByUser.get(attempt.user_id)), notification.type as NotificationType)) {
    await finishDead(context, attempt, {
      attemptCount,
      failureCode: "push-disabled",
      error: "user disabled push notifications",
    }, at);
    return { ok: false, revoked: false };
  }

  const subscription = attempt.push_subscription_id
    ? context.subscriptions.get(attempt.push_subscription_id) ?? null
    : null;
  if (subscription) return { ok: true, notification, subscription };

  context.emitMetric("push.endpoint.revoked", 1, {
    unit: "count",
    attributes: { reason: "subscription-missing", channel: "push" },
  });
  await finishDead(context, attempt, {
    attemptCount,
    failureCode: "subscription-missing",
    error: "push subscription no longer exists",
  }, at);
  return { ok: false, revoked: true };
}

/** 处理单条到期投递，返回结果分类供主循环计数 */
async function processAttempt(
  context: RetryContext,
  attempt: PushDeliveryAttempt,
): Promise<PushRetryOutcome> {
  const attemptCount = attemptCountFor(attempt);
  const at = context.now();

  const ready = await preflight(context, attempt, attemptCount, at);
  if (!ready.ok) return ready.revoked ? "revoked" : "dead";
  const { notification, subscription } = ready;

  try {
    await context.provider.send({
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      title: notification.title,
      body: notification.body ?? undefined,
      link: notification.link,
      tag: notification.idempotency_key ?? undefined,
    });
  } catch (error) {
    if (isPushSubscriptionGone(error)) {
      await handleGoneEndpoint(context, attempt, error, attemptCount, at);
      return "revoked";
    }
    return scheduleRetry(context, attempt, error, attemptCount, at);
  }

  try {
    await context.dependencies.markSent(attempt.notification_id, attempt.endpoint, attemptCount, at);
  } catch (error) {
    await context.reportError("[Push Retry] 成功回执写入失败", error);
  }
  return "sent";
}

/**
 * 处理一批到期投递。任一端点失败都不会中断整轮：
 * 回执写入失败会被上报，但已成功的端点不会被重复发送。
 */
export async function runPushRetry(dependencies: PushRetryDependencies): Promise<PushRetryResult> {
  const result: PushRetryResult = { pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 };
  const now = dependencies.now ?? (() => new Date());
  const batchSize = dependencies.batchSize ?? PUSH_RETRY_BATCH_SIZE;

  const due = await dependencies.listDue(batchSize, now());
  result.pulled = due.length;
  if (due.length === 0) return result;

  const context = await loadContext(dependencies, due);
  for (const attempt of due) {
    const outcome = await processAttempt(context, attempt);
    if (outcome === "revoked") {
      // 失效端点同时计入 dead 与 revoked，便于告警“端点质量”而不是“投递量”
      result.dead += 1;
      result.revoked += 1;
      continue;
    }
    result[outcome] += 1;
  }
  return result;
}
