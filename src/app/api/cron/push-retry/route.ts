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
 * 返回脱敏计数 `{ pulled, sent, retried, dead, revoked }`，不含 endpoint 或用户标识。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { logApiError } from "@/lib/api-log";
import { isCronAuthorized } from "@/lib/cron-auth";
import { recordMetric } from "@/lib/metrics";
import { createPushProvider } from "@/lib/push-provider";
import { runPushRetry } from "@/lib/push-retry";
import {
  PUSH_BACKLOG_ALERT_THRESHOLD,
  countPendingPushDeliveries,
  listDuePushDeliveryAttempts,
  markPushDeliveryDead,
  markPushDeliveryRetry,
  markPushDeliverySent,
} from "@/lib/repositories/push-delivery-attempts";
import {
  getPushSubscriptionById,
  removePushSubscription,
} from "@/lib/repositories/push-subscriptions";
import { listNotificationsByIds } from "@/lib/repositories/notifications";
import { listNotificationSettingsByIds } from "@/lib/repositories/profiles";

export const dynamic = "force-dynamic";

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
      createProvider: () => createPushProvider(),
      listDue: listDuePushDeliveryAttempts,
      listNotifications: listNotificationsByIds,
      getSubscription: getPushSubscriptionById,
      getNotificationSettings: (userIds) => listNotificationSettingsByIds(userIds),
      markSent: markPushDeliverySent,
      markRetry: markPushDeliveryRetry,
      markDead: markPushDeliveryDead,
      removeSubscription: removePushSubscription,
    });

    recordMetric("cron.push-retry.completed", Date.now() - startedAt, {
      unit: "ms",
      attributes: { ...result },
    });
    return jsonNoStore(result);
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
