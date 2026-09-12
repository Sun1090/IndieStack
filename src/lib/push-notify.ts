/** Immediate Web Push delivery for a single in-app notification. */
import { isPushSubscriptionGone, type PushMessage, type PushProvider } from "@/lib/push-provider";
import { createPushProvider } from "@/lib/push-provider";
import { shouldSendPush, type EmailPreferences } from "@/lib/notification-prefs";
import {
  listPushSubscriptions,
  removePushSubscription,
  type PushSubscriptionRecord,
} from "@/lib/repositories/push-subscriptions";
import { logApiError } from "@/lib/api-log";
import type { NotificationType } from "@/lib/repositories/notifications";

export interface PushNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  idempotencyKey?: string;
}

export interface PushDeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  revoked: number;
  skipped: boolean;
}

export interface PushDeliveryDependencies {
  createProvider?: () => PushProvider;
  listSubscriptions?: (userId: string) => Promise<PushSubscriptionRecord[]>;
  removeSubscription?: (userId: string, endpoint: string) => Promise<void>;
  reportError?: (message: string, error: unknown) => Promise<void>;
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

/**
 * Push is best-effort at the event boundary; failed deliveries are logged and
 * never block the in-app notification or the email channel. HTTP 404/410 means
 * the browser endpoint is permanently invalid, so it is removed immediately.
 */
export async function deliverPushNotification(
  input: PushNotificationInput,
  preferences: EmailPreferences,
  dependencies: PushDeliveryDependencies = {},
): Promise<PushDeliveryResult> {
  const result: PushDeliveryResult = { attempted: 0, sent: 0, failed: 0, revoked: 0, skipped: false };
  if (!shouldSendPush(preferences, input.type)) return { ...result, skipped: true };

  const listSubscriptions = dependencies.listSubscriptions ?? listPushSubscriptions;
  const removeSubscription = dependencies.removeSubscription ?? removePushSubscription;
  const reportError = dependencies.reportError ?? logApiError;
  const provider = (dependencies.createProvider ?? createPushProvider)();

  const subscriptions = await listSubscriptions(input.userId);
  if (subscriptions.length === 0) return { ...result, skipped: true };
  if (!provider.configured) {
    throw new Error("Web Push provider is not configured");
  }

  for (const subscription of subscriptions) {
    result.attempted += 1;
    try {
      await provider.send(messageFor(input, subscription));
      result.sent += 1;
    } catch (error) {
      if (isPushSubscriptionGone(error)) {
        try {
          await removeSubscription(input.userId, subscription.endpoint);
          result.revoked += 1;
          continue;
        } catch (removeError) {
          await reportError("[Push Notify] 失效订阅清理失败", removeError);
        }
      }
      result.failed += 1;
      await reportError("[Push Notify] 投递失败", error);
    }
  }

  return result;
}
