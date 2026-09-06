/** Provider-neutral Web Push contract.
 * The browser subscription lifecycle is handled by the client; delivery adapters
 * implement this contract without leaking provider SDKs into domain code.
 */
export interface PushMessage {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body?: string;
  link?: string | null;
}

export interface PushProvider {
  readonly name: string;
  readonly configured: boolean;
  send(message: PushMessage): Promise<void>;
}

/**
 * Safe default until a server-side Web Push adapter is configured. It fails
 * explicitly rather than silently claiming delivery.
 */
export function createPushProvider(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): PushProvider {
  const configured = Boolean(env.VAPID_PRIVATE_KEY && env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
  return {
    name: "web-push",
    configured,
    async send() {
      if (!configured) throw new Error("Web Push provider is not configured");
      throw new Error("Web Push delivery adapter is not installed");
    },
  };
}
