/**
 * 营销邮件订阅数据访问层（v0.5.0 A05，迁移 016）
 * double opt-in：开关打开 → pending + 确认邮件 → 用户点击确认链接 → subscribed。
 * 状态流转全部经 service_role（公开退订路由无用户上下文），应用层负责约束。
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type MarketingSubscriptionStatus = "pending" | "subscribed" | "unsubscribed";

export interface MarketingSubscription {
  user_id: string;
  email: string;
  status: MarketingSubscriptionStatus;
  token: string;
}

/** 生成不可猜测的确认/退订 token（48 位十六进制） */
export function generateSubscriptionToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getSubscriptionByUserId(userId: string): Promise<MarketingSubscription | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_subscriptions")
    .select("user_id,email,status,token")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MarketingSubscription | null) ?? null;
}

/**
 * 开启营销邮件时调用：已订阅则原样返回；否则置 pending 并刷新 token
 * （重复开关复用同一行，旧确认/退订链接随之失效）。
 */
export async function upsertPendingSubscription(
  userId: string,
  email: string,
): Promise<MarketingSubscription> {
  const existing = await getSubscriptionByUserId(userId);
  if (existing?.status === "subscribed") return existing;

  const token = generateSubscriptionToken();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_subscriptions")
    .upsert(
      { user_id: userId, email, status: "pending", token, confirmed_at: null },
      { onConflict: "user_id" },
    )
    .select("user_id,email,status,token")
    .single();
  if (error) throw new Error(error.message);
  return data as MarketingSubscription;
}

async function updateStatusByToken(token: string, status: MarketingSubscriptionStatus): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_subscriptions")
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...(status === "subscribed" ? { confirmed_at: new Date().toISOString() } : {}),
    })
    .eq("token", token)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** 确认订阅（公开确认路由凭 token 调用）；token 无效返回 false */
export async function confirmSubscription(token: string): Promise<boolean> {
  return updateStatusByToken(token, "subscribed");
}

/** 退订（公开退订路由凭 token 调用）；token 无效返回 false */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  return updateStatusByToken(token, "unsubscribed");
}

/** 关闭营销开关：按用户退订（无订阅记录时静默） */
export async function deactivateSubscription(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("marketing_subscriptions")
    .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** 已确认订阅的收件人列表（营销发送入口的受众来源） */
export async function listSubscribedEmails(limit = 1000): Promise<{ email: string; token: string }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_subscriptions")
    .select("email,token")
    .eq("status", "subscribed")
    .order("confirmed_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as { email: string; token: string }[];
}
