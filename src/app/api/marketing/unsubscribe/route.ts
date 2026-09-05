/**
 * 营销邮件退订（v0.5.0 A05）
 * 每封营销邮件页脚的退订链接点击入口：凭 token 置 unsubscribed 后跳回站点。
 * GET /api/marketing/unsubscribe?token=***
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { unsubscribeByToken } from "@/lib/repositories/marketing";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return jsonNoStore({ error: "token required" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const unsubscribed = await unsubscribeByToken(token);
    if (!unsubscribed) {
      return jsonNoStore({ error: "Invalid token" }, { status: 404 });
    }
    return NextResponse.redirect(new URL("/?marketing=unsubscribed", siteUrl), { status: 302 });
  } catch {
    return jsonNoStore({ error: "Internal server error" }, { status: 500 });
  }
}
