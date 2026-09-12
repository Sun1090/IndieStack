import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

export interface PushSubscriptionRecord {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
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

/** Service-role read used by server-side delivery; RLS still protects user-facing access. */
export async function listPushSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,user_agent")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`push subscriptions list: ${error.message}`);
  return (data ?? []) as PushSubscriptionRecord[];
}

/** Removes a permanently gone browser endpoint (HTTP 404/410 from the push service). */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) throw new Error(`push subscription remove: ${error.message}`);
}
