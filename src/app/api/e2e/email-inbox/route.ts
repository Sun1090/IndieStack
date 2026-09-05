/**
 * E2E 测试收件箱（仅 Mock 模式启用）
 * sendResendEmail 在 E2E 下指向本端点（RESEND_API_URL），
 * 记录每封"发送"的邮件，供 Playwright 断言请求体而无需真实出网。
 *
 * 故障注入：查询参数 ?failNext=1 让下一次 POST 返回 503，用于测试 worker
 * 的失败回执（累加 email_attempts / email_error 并写 recordWorkerRun.failed）。
 * 注入是一次性的，下次 POST 自动恢复 200（避免污染后续测试）。
 *
 * 生产与开发非 mock 场景直接 404，绝不作为业务通道暴露。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";

export const dynamic = "force-dynamic";

type CapturedEmail = {
  id: string;
  to: string;
  subject: string;
  html: string;
  receivedAt: string;
};

const emails: CapturedEmail[] = [];
let counter = 0;
let failNext = false;

function authOk(request: NextRequest): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const resendOk =
    Boolean(process.env.RESEND_API_KEY) && auth === `Bearer ${process.env.RESEND_API_KEY}`;
  // E2E 调试接口（DELETE/注入）：spec 持有 E2E_BEARER_TOKEN，与 RESEND_API_KEY 等价可信。
  const e2eOk =
    Boolean(process.env.E2E_BEARER_TOKEN) && auth === `Bearer ${process.env.E2E_BEARER_TOKEN}`;
  return resendOk || e2eOk;
}

export async function POST(request: NextRequest) {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  if (!authOk(request)) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }

  // 故障注入：上一次 ?failNext=1 让本轮返回 503，下一轮自动恢复
  if (failNext) {
    failNext = false;
    return jsonNoStore({ error: "Injected failure" }, { status: 503 });
  }

  let body: { to?: string[]; subject?: string; html?: string };
  try {
    body = (await request.json()) as { to?: string[]; subject?: string; html?: string };
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, { status: 400 });
  }

  counter += 1;
  emails.push({
    id: `e2e-mail-${counter}`,
    to: body.to?.[0] ?? "",
    subject: body.subject ?? "",
    html: body.html ?? "",
    receivedAt: new Date().toISOString(),
  });

  return jsonNoStore({ id: emails[emails.length - 1].id });
}

export async function GET(request: NextRequest) {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  const search = request.nextUrl.searchParams;
  const to = search.get("to") ?? "";
  // ?failNext=1 作为副作用标志位：置位失败开关后照常返回当前收件箱
  if (search.get("failNext") === "1") {
    failNext = true;
  }
  const filtered = to ? emails.filter((e) => e.to === to) : [...emails];
  return jsonNoStore({
    total: filtered.length,
    emails: filtered.map((e) => ({ ...e })),
  });
}

export async function DELETE(request: NextRequest) {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  if (!authOk(request)) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }
  const cleared = emails.length;
  emails.length = 0;
  counter = 0;
  failNext = false;
  return jsonNoStore({ cleared });
}
