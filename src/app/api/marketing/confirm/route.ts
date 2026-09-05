/**
 * 营销邮件订阅确认（double opt-in，v0.5.0 A05）
 * 邮件中的确认链接点击入口：凭 token 置 subscribed 后跳回站点。
 * GET /api/marketing/confirm?token=***
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { confirmSubscription } from "@/lib/repositories/marketing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return jsonNoStore({ error: "token required" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const confirmed = await confirmSubscription(token);
    if (!confirmed) {
      return jsonNoStore({ error: "Invalid token" }, { status: 404 });
    }
    return NextResponse.redirect(new URL("/?marketing=confirmed", siteUrl), { status: 302 });
  } catch {
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
