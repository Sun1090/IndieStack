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

    // 解析当前用户的团队，随结账会话写入 metadata，供 webhook 订阅落库使用
    const supabase = await createClient();
    const { data: membership } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", auth.data.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // scope 收紧：团队已有有效订阅时拒绝重复购买（改走 Customer Portal 管理）
    if (membership?.team_id) {
      const { data: activeSub } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("team_id", membership.team_id)
        .in("status", ["active", "trialing"])
        .limit(1)
        .maybeSingle();
      if (activeSub) {
        return jsonNoStore({ error: "alreadySubscribed" }, { status: 409 });
      }
    }

    // 幂等键：用户 + 价格 + 5 分钟窗口，防双击/重试建出多个 session
    const windowId = Math.floor(Date.now() / (5 * 60 * 1000));
    const { url } = await createCheckoutSession(body.priceId, {
      userId: auth.data.id,
      teamId: membership?.team_id,
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
