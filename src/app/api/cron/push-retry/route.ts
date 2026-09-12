/**
 * Web Push 重试 Worker（cron）
 *
 * GET|POST /api/cron/push-retry
 * Header: authorization: Bearer <CRON_SECRET>（Vercel Cron 自动附加）
 *         或 x-cron-secret: <CRON_SECRET>（手动运维调用）
 *
 * 由 Vercel Cron 每 15 分钟调度（见 `vercel.json`）。单轮拉取上限
 * `PUSH_RETRY_BATCH_SIZE`，成功/重试/死信回执均落在 `push_delivery_attempts`。
 * 订阅端点永久失效（404/410）时同时撤销本地订阅记录并上报失效端点指标。
 *
 * 每轮结束执行保留策略（sent 保留 7 天、dead 保留 30 天，pending 永不清理）。
 * 返回脱敏计数 `{ pulled, sent, retried, dead, revoked, pruned }`，不含 endpoint 或用户标识。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { isCronAuthorized } from "@/lib/cron-auth";
import { recordMetric } from "@/lib/metrics";
import { isMockEnabled } from "@/lib/mock/config";
import { createMockPushTransport } from "@/lib/mock/push-transport";
import { createPushProvider, type PushProvider } from "@/lib/push-provider";
import { runPushRetry } from "@/lib/push-retry";
import {
  PUSH_BACKLOG_ALERT_THRESHOLD,
  PUSH_DEAD_RETENTION_DAYS,
  PUSH_SENT_RETENTION_DAYS,
  countPendingPushDeliveries,
  listDuePushDeliveryAttempts,
  markPushDeliveryDead,
  markPushDeliveryRetry,
  markPushDeliverySent,
  prunePushDeliveryAttempts,
} from "@/lib/repositories/push-delivery-attempts";
import {
  getPushSubscriptionById,
  removePushSubscription,
} from "@/lib/repositories/push-subscriptions";
import { listNotificationsByIds } from "@/lib/repositories/notifications";
import { listNotificationSettingsByIds } from "@/lib/repositories/profiles";

export const dynamic = "force-dynamic";

/**
 * 执行保留策略并上报指标；清理失败只记日志与失败指标，不影响本轮投递结果，
 * 因此这里吞掉异常并返回 null，让 cron 仍以 200 返回投递计数。
 */
async function pruneWithMetrics(): Promise<{ sent: number; dead: number } | null> {
  try {
    const pruned = await prunePushDeliveryAttempts();
    recordMetric("push.queue.pruned", pruned.sent, {
      unit: "count",
      attributes: { status: "sent", retention_days: PUSH_SENT_RETENTION_DAYS },
    });
    recordMetric("push.queue.pruned", pruned.dead, {
      unit: "count",
      attributes: { status: "dead", retention_days: PUSH_DEAD_RETENTION_DAYS },
    });
    return pruned;
  } catch (error) {
    recordMetric("push.queue.prune_failed", 1, {
      attributes: { error_type: error instanceof Error ? error.name : "unknown" },
    });
    await logApiError("[Cron Push Retry] 队列清理失败（不影响投递结果）", error);
    return null;
  }
}

/**
 * Mock 模式下换成保留端点传输层（E2E 专用，见 `lib/mock/push-transport`）：
 * web-push 固定走 `https.request`，无法用环境变量把出网请求重定向到本地捕获端点，
 * 因此只替换传输层，适配器本身的配置校验、载荷构造与错误映射保持真实。
 */
function createRuntimePushProvider(): PushProvider {
  return isMockEnabled
    ? createPushProvider(undefined, createMockPushTransport())
    : createPushProvider();
}

async function handle(request: NextRequest) {
  if (!isCronAuthorized(request.headers, process.env.CRON_SECRET)) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const backlog = await countPendingPushDeliveries();
    recordMetric("push.backlog", backlog, { unit: "count" });
    if (backlog > PUSH_BACKLOG_ALERT_THRESHOLD) {
      await logApiError(
        `[Cron Push Retry] 待重试队列积压 ${backlog} 条（阈值 ${PUSH_BACKLOG_ALERT_THRESHOLD}）`,
        new Error("push_backlog_threshold_exceeded"),
      );
    }

    const result = await runPushRetry({
      createProvider: createRuntimePushProvider,
      listDue: listDuePushDeliveryAttempts,
      listNotifications: listNotificationsByIds,
      getSubscription: getPushSubscriptionById,
      getNotificationSettings: (userIds) => listNotificationSettingsByIds(userIds),
      markSent: markPushDeliverySent,
      markRetry: markPushDeliveryRetry,
      markDead: markPushDeliveryDead,
      removeSubscription: removePushSubscription,
    });

    // 保留策略：清理过期终态行，避免队列表无限增长；pending 永不清理。
    const pruned = await pruneWithMetrics();

    recordMetric("cron.push-retry.completed", Date.now() - startedAt, {
      unit: "ms",
      attributes: { ...result },
    });
    return jsonNoStore({ ...result, pruned });
  } catch (error) {
    recordMetric("cron.push-retry.failed", 1, {
      attributes: { error_type: error instanceof Error ? error.name : "unknown" },
    });
    await logApiError("[Cron Push Retry] 执行失败", error);
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
