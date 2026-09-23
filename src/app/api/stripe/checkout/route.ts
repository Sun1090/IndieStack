/**
 * Stripe Checkout API 路由
 * 创建订阅结账会话并返回跳转 URL
 *
 * POST /api/stripe/checkout
 * Body: { priceId: string }
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { safelyRequireAuth } from "@/lib/auth/guards";
import { logApiError } from "@/lib/api-log";
import { createCheckoutSession, isStripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * 结账前的「谁在买、已经在买了吗」。
 *
 * 三态而不是 `teamId | null`：这两次读取决定的是**要不要放行这次购买**——把「没读到」
 * 当成「没有团队」会让已有有效订阅的团队再买一份，那是要花钱的分叉，不是显示错误。
 */
type CheckoutScope =
  | { status: "ok"; teamId?: string }
  | { status: "unavailable" }
  | { status: "subscribed" };

async function readCheckoutScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<CheckoutScope> {
  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    await logApiError("[Stripe Checkout] 团队归属读取失败", membershipError);
    return { status: "unavailable" };
  }

  // 没有归属是合法状态（个人用户），照旧放行。
  if (!membership?.team_id) return { status: "ok" };

  // scope 收紧：团队已有有效订阅时拒绝重复购买（改走 Customer Portal 管理）
  const { data: activeSub, error: activeSubError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("team_id", membership.team_id)
    .in("status", ["active", "trialing"])
    .limit(1)
    .maybeSingle();
  if (activeSubError) {
    await logApiError("[Stripe Checkout] 现有订阅读取失败", activeSubError);
    return { status: "unavailable" };
  }

  if (activeSub) return { status: "subscribed" };
  return { status: "ok", teamId: membership.team_id };
}

/**
 * POST /api/stripe/checkout
 * 为当前用户创建 Stripe Checkout 订阅会话
 */
export async function POST(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return jsonNoStore(
      { error: "rateLimited", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return jsonNoStore({ error: "notAuthenticated" }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return jsonNoStore({ error: "stripeNotConfigured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { priceId?: string };
    if (!body.priceId || typeof body.priceId !== "string") {
      return jsonNoStore({ error: "priceIdRequired" }, { status: 400 });
    }

    // 白名单校验：仅允许配置中的定价 ID，防止任意 priceId 被滥用
    const allowedPriceIds = [
      process.env.STRIPE_PRO_PRICE_ID,
      process.env.STRIPE_ENTERPRISE_PRICE_ID,
    ].filter((id): id is string => Boolean(id));
    if (allowedPriceIds.length > 0 && !allowedPriceIds.includes(body.priceId)) {
      return jsonNoStore({ error: "invalidPriceId" }, { status: 400 });
    }

    // 解析当前用户的团队，随结账会话写入 metadata，供 webhook 订阅落库使用。
    // 读失败在这里的方向是**放行**（跳过 scope 检查就能再买一份），所以它不停下来就是钱的分叉。
    const supabase = await createClient();
    const scope = await readCheckoutScope(supabase, auth.data.id);
    if (scope.status === "unavailable") {
      return jsonNoStore({ error: "checkoutUnavailable" }, { status: 503 });
    }
    if (scope.status === "subscribed") {
      return jsonNoStore({ error: "alreadySubscribed" }, { status: 409 });
    }

    // 幂等键：用户 + 价格 + 5 分钟窗口，防双击/重试建出多个 session
    const windowId = Math.floor(Date.now() / (5 * 60 * 1000));
    const { url } = await createCheckoutSession(body.priceId, {
      userId: auth.data.id,
      teamId: scope.teamId,
      customerEmail: auth.data.email,
      idempotencyKey: `checkout:${auth.data.id}:${body.priceId}:${windowId}`,
    });

    if (!url) {
      return jsonNoStore({ error: "checkoutFailed" }, { status: 500 });
    }

    return jsonNoStore({ url });
  } catch (error) {
    await logApiError("[Stripe Checkout] 创建结账会话失败", error);
    return jsonNoStore({ error: "internalError" }, { status: 500 });
  }
}
