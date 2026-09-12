/** Provider-neutral Web Push contract and the production web-push adapter. */
import webpush from "web-push";
import { recordMetric } from "@/lib/metrics";

export interface PushMessage {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body?: string;
  link?: string | null;
  tag?: string;
}

export interface PushProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: PushMessage): Promise<void>;
}

export interface WebPushSendResult {
  statusCode: number;
}

export interface WebPushTransport {
  sendNotification(
    subscription: webpush.PushSubscription,
    payload: string,
    options: webpush.RequestOptions,
  ): Promise<WebPushSendResult>;
}

const DEFAULT_TTL_SECONDS = 60 * 60;
const DEFAULT_TIMEOUT_MS = 10_000;

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : null;
}

/** A 404/410 means the browser subscription is permanently gone and must be revoked. */
export function isPushSubscriptionGone(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 404 || status === 410;
}

function failureReason(error: unknown): string {
  const status = errorStatus(error);
  if (status === 404 || status === 410) return "subscription-gone";
  if (status !== null) return `http-${status}`;
  if (error instanceof Error && /timeout/i.test(error.message)) return "timeout";
  return "network";
}

/**
 * The adapter is safe to construct without credentials: `configured` is false and
 * `send` fails explicitly. This keeps development and preview deployments from
 * silently reporting push delivery when VAPID is not provisioned.
 */
export function createPushProvider(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  transport: WebPushTransport = webpush,
): PushProvider {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const configured = Boolean(publicKey && privateKey);
  const subject = env.NEXT_PUBLIC_APP_URL?.startsWith("https://")
    ? env.NEXT_PUBLIC_APP_URL
    : "mailto:support@indiestack.dev";

  return {
    name: "web-push",
    configured,
    async send(message) {
      if (!configured || !publicKey || !privateKey) {
        recordMetric("push.send.failed", 1, {
          attributes: { provider: "web-push", reason: "not-configured" },
        });
        throw new Error("Web Push provider is not configured");
      }

      try {
        const result = await transport.sendNotification(
          {
            endpoint: message.endpoint,
            keys: { p256dh: message.p256dh, auth: message.auth },
          },
          JSON.stringify({
            title: message.title,
            body: message.body ?? "",
            url: message.link ?? undefined,
            tag: message.tag,
          }),
          {
            TTL: DEFAULT_TTL_SECONDS,
            timeout: DEFAULT_TIMEOUT_MS,
            urgency: "high",
            vapidDetails: { subject, publicKey, privateKey },
          },
        );
        recordMetric("push.send.completed", 1, {
          attributes: { provider: "web-push", status_code: result.statusCode },
        });
      } catch (error) {
        recordMetric("push.send.failed", 1, {
          attributes: { provider: "web-push", reason: failureReason(error) },
        });
        throw error;
      }
    },
  };
}
