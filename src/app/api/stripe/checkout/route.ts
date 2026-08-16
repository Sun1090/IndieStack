/**
 * Stripe Checkout API 路由
 * 创建订阅结账会话并返回跳转 URL
 *
 * POST /api/stripe/checkout
 * Body: { priceId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { safelyRequireAuth } from "@/lib/auth/guards";
import { createCheckoutSession, isStripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/checkout
 * 为当前用户创建 Stripe Checkout 订阅会话
 */
export async function POST(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "rateLimited", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return NextResponse.json({ error: "notAuthenticated" }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "stripeNotConfigured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { priceId?: string };
    if (!body.priceId || typeof body.priceId !== "string") {
      return NextResponse.json({ error: "priceIdRequired" }, { status: 400 });
    }

    // 白名单校验：仅允许配置中的定价 ID，防止任意 priceId 被滥用
    const allowedPriceIds = [
      process.env.STRIPE_PRO_PRICE_ID,
      process.env.STRIPE_ENTERPRISE_PRICE_ID,
    ].filter((id): id is string => Boolean(id));
    if (allowedPriceIds.length > 0 && !allowedPriceIds.includes(body.priceId)) {
      return NextResponse.json({ error: "invalidPriceId" }, { status: 400 });
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

    const { url } = await createCheckoutSession(body.priceId, {
      userId: auth.data.id,
      teamId: membership?.team_id,
      customerEmail: auth.data.email,
    });

    if (!url) {
      return NextResponse.json({ error: "checkoutFailed" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[Stripe Checkout] 创建结账会话失败:", error);
    return NextResponse.json({ error: "internalError" }, { status: 500 });
  }
}
