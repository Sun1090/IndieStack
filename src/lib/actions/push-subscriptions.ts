"use server";

import { createClient } from "@/lib/supabase/server";
import { registerPushSubscription, revokePushSubscription } from "@/lib/repositories/push-subscriptions";
import { fail, ok } from "@/lib/types/action-result";

function readSubscription(formData: FormData) {
  const endpoint = formData.get("endpoint");
  const p256dh = formData.get("p256dh");
  const auth = formData.get("auth");
  if ([endpoint, p256dh, auth].some((value) => typeof value !== "string" || !value.trim())) return null;
  return { endpoint: endpoint as string, p256dh: p256dh as string, auth: auth as string, userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent };
}

export async function subscribeToPush(formData: FormData) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("notAuthenticated");
  const subscription = readSubscription(formData);
  if (!subscription) return fail("invalidSettings");
  try { await registerPushSubscription(user.id, subscription); return ok(); }
  catch (error) { console.error("[subscribeToPush] failed", error); return fail("databaseError"); }
}

export async function unsubscribeFromPush(formData: FormData) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return fail("notAuthenticated");
  const endpoint = formData.get("endpoint");
  if (typeof endpoint !== "string" || !endpoint.trim()) return fail("invalidSettings");
  try { await revokePushSubscription(user.id, endpoint); return ok(); }
  catch (error) { console.error("[unsubscribeFromPush] failed", error); return fail("databaseError"); }
}
