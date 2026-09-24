/**
 * 营销邮件订阅数据访问层（v0.5.0 A05，迁移 016）
 * double opt-in：开关打开 → pending + 确认邮件 → 用户点击确认链接 → subscribed。
 * 状态流转全部经 service_role（公开退订路由无用户上下文），应用层负责约束。
 */
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type MarketingSubscriptionStatus = "pending" | "subscribed" | "unsubscribed";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashSubscriptionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
      {
        user_id: userId,
        email,
        status: "pending",
        token,
        token_hash: hashSubscriptionToken(token),
        token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        confirmed_at: null,
      },
      { onConflict: "user_id" },
    )
    .select("user_id,email,status,token")
    .single();
  if (error) throw new Error(error.message);
  return data as MarketingSubscription;
}

/**
 * 确认与退订共用一次「按 token 改状态」。
 *
 * `token_expires_at` 只在写入 pending 时算过一次（7 天），确认成功**不会**刷新它。
 * 所以这条有效期能约束的只有「这次 double opt-in 请求还算不算数」——它绝不能约束退订：
 * 一旦这里也判过期，订阅满 7 天的收件人会在每一封后续营销邮件里拿到一个必然 404 的
 * 退订链接，而邮件还在继续寄——那条页脚是本仓库自己写的「合规链接」，出口不能有时间窗。
 * 旧 token 也不能伤害别人：token 每次重新开关都会轮换，`token_hash` 对不上就是命中不了。
 */
async function updateStatusByToken(token: string, status: MarketingSubscriptionStatus): Promise<boolean> {
  if (typeof token !== "string" || token.length < 16 || token.length > 256) return false;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const update = {
    status,
    updated_at: now,
    ...(status === "subscribed" ? { confirmed_at: now } : {}),
  };
  const byToken = admin
    .from("marketing_subscriptions")
    .update(update)
    .eq("token_hash", hashSubscriptionToken(token));
  const hashed = await (status === "unsubscribed"
    ? byToken
    : byToken.gt("token_expires_at", now)
  ).select("id");
  if (hashed.error) throw new Error(hashed.error.message);
  return (hashed.data ?? []).length > 0;
}

/** 确认订阅（公开路由凭 token 调用）；token 无效或过期返回 false */
export async function confirmSubscription(token: string): Promise<boolean> {
  return updateStatusByToken(token, "subscribed");
}

/** 退订（公开路由凭 token 调用）；token 轮换过才对不上，**过期不影响**——退订出口不设时间窗 */
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
