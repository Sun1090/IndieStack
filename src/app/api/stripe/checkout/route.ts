/**
 * Stripe Checkout API 路由
 * 创建订阅结账会话并返回跳转 URL
 *
 * POST /api/stripe/checkout
 * Body: { priceId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
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
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 }
    );
  }

  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 401 });
  }

  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json()) as { priceId?: string };
    if (!body.priceId || typeof body.priceId !== "string") {
      return NextResponse.json({ error: "priceId is required" }, { status: 400 });
    }

    const { url } = await createCheckoutSession(body.priceId, {
      userId: auth.data.id,
      customerEmail: auth.data.email,
    });

    if (!url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (error) {
    console.error("[Stripe Checkout] 创建结账会话失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
