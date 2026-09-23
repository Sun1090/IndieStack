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

/** 哪一道前置读取失败了。 */
type CheckoutSource = "membership" | "subscription";

/** 读取失败时用来记日志的标签，键与 `CheckoutSource` 一一对应。 */
const FAILURE_LABEL: Record<CheckoutSource, string> = {
  membership: "团队归属",
  subscription: "现有订阅",
};

/**
 * 结账前置读取的结果：`failed`（没读到）、`duplicate`（读到了，且不该再买）与 `ok`
 * 是三件事，混成一件就会把「我们没查到」答成「你没有订阅」。
 */
type CheckoutScope =
  | { status: "ok"; teamId: string | undefined }
  | { status: "duplicate" }
  | { status: "failed"; source: CheckoutSource; error: unknown };

/** 当前用户属于哪个团队，以及该团队是否已经有有效订阅。 */
async function readCheckoutScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<CheckoutScope> {
  const { data: membership, error } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { status: "failed", source: "membership", error };

  const teamId = membership?.team_id;
  if (!teamId) return { status: "ok", teamId: undefined };

  const { data: activeSub, error: activeSubError } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("team_id", teamId)
    .in("status", ["active", "trialing"])
    .limit(1)
    .maybeSingle();
  if (activeSubError) return { status: "failed", source: "subscription", error: activeSubError };

  return activeSub ? { status: "duplicate" } : { status: "ok", teamId };
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

    const supabase = await createClient();
    // 这两道读取是**门禁**，不是可选信息：读不到就必须拒绝这次结账。
    // 原来不接 error，读失败的后果是往下走——
    //   1) 跳过「团队已有有效订阅」检查，重复购买被放行；
    //   2) `teamId` 以 undefined 进 metadata，钱照收，但 webhook 再也认不出这个订阅属于哪个团队。
    // 两条都是 fail-open，而这条链上失败的方向必须是「不扣钱」：用户可以重试，
    // 「扣了钱却归不了款」是要人工介入的事故。
    const scope = await readCheckoutScope(supabase, auth.data.id);
    if (scope.status === "failed") {
      await logApiError(`[Stripe Checkout] ${FAILURE_LABEL[scope.source]}读取失败`, scope.error);
      return jsonNoStore({ error: "checkoutUnavailable" }, { status: 503 });
    }

    // scope 收紧：团队已有有效订阅时拒绝重复购买（改走 Customer Portal 管理）
    if (scope.status === "duplicate") {
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
