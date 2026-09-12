/**
 * 营销邮件退订（v0.5.0 A05）
 * 每封营销邮件页脚的退订链接点击入口：凭 token 置 unsubscribed 后跳回站点。
 * POST /api/marketing/unsubscribe?token=***
 */

import { NextRequest, NextResponse } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { renderMarketingActionPage } from "@/lib/marketing-action-page";
import { unsubscribeByToken } from "@/lib/repositories/marketing";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ??
    (request.headers.get("content-type")?.includes("application/json")
      ? ((await request.json().catch(() => null)) as { token?: string } | null)?.token
      : (await request.formData().catch(() => null))?.get("token")?.toString());
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

export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return jsonNoStore({ error: "token required" }, { status: 400 });
  return new NextResponse(renderMarketingActionPage({
    action: "unsubscribe",
    title: "退订",
    submitLabel: "退订",
    token,
  }), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
