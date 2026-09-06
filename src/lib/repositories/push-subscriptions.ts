import { createClient } from "@/lib/supabase/server";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

/** Idempotent registration: endpoint uniqueness is enforced by the database. */
export async function registerPushSubscription(userId: string, input: PushSubscriptionInput): Promise<void> {
  const client = await createClient();
  const { error } = await client.from("push_subscriptions").upsert({
    user_id: userId,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    user_agent: input.userAgent ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,endpoint" });
  if (error) throw new Error(`push subscription register: ${error.message}`);
}

export async function revokePushSubscription(userId: string, endpoint: string): Promise<void> {
  const client = await createClient();
  const { error } = await client.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw new Error(`push subscription revoke: ${error.message}`);
}
