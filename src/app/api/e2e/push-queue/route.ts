/**
 * E2E 测试 Push 队列种子/查询端点（仅 Mock 模式启用）
 *
 * 供 `push-retry.spec.ts` 直接驱动真实 cron 路由
 * （`POST /api/cron/push-retry`）跑完整的
 * 失败 → 退避重试 → 死信 → 失效端点撤销链路，
 * 无需真实数据库、VAPID 凭据或 push service。
 *
 * Mock 模式下 cron 路由使用 `lib/mock/push-transport` 的保留端点传输层，
 * 端点路径决定投递结果（/ok、/transient、/timeout、/gone）。
 *
 * POST /api/e2e/push-queue
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   body: {
 *     endpoint?: string,               // 默认 https://push-e2e.test/ok
 *     status?: "pending"|"sent"|"dead",// 默认 pending
 *     attemptCount?: number,           // 默认 0
 *     dueInMs?: number,                // next_attempt_at = now + dueInMs（默认 -1000，即已到期）
 *     type?: string,                   // 通知类型，默认 system
 *     withNotification?: boolean,      // 默认 true；false 用于 notification-missing 死信
 *     withSubscription?: boolean,      // 默认 true；false 用于 subscription-missing 死信
 *     pushDisabled?: boolean,          // true 时把 mock 用户 push 偏好关掉
 *     sentAtOffsetMs?: number,         // status=sent 的 sent_at 偏移（保留策略用例）
 *     lastAttemptAtOffsetMs?: number,  // status=dead 的 last_attempt_at 偏移（保留策略用例）
 *     createdAtOffsetMs?: number,      // created_at 偏移（行龄上界用例；默认 0 即此刻入队）
 *   }
 *   → { notificationId, subscriptionId, attemptId }
 *
 * GET /api/e2e/push-queue[?endpoint=<url>]
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → { total, attempts: [...], subscriptions: [...] }
 *
 * DELETE /api/e2e/push-queue
 *   Authorization: Bearer <E2E_BEARER_TOKEN>
 *   → 清空队列表 / Push 订阅 / mock 用户通知，并复位 push 偏好
 *
 * 生产与开发非 mock 场景直接 404，绝不作为业务通道暴露。
 */

import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/api-response";
import { isMockEnabled } from "@/lib/mock";
import { createAdminClient } from "@/lib/supabase/admin";
import { e2eBearerAuthorized } from "@/lib/testing/e2e-bearer";

export const dynamic = "force-dynamic";

/** 与 src/lib/mock/data.ts 的 MOCK_USER_ID 保持一致 */
const MOCK_USER_ID = "mock-user-001";
/** 与 src/lib/mock/push-transport.ts 的 E2E_PUSH_ENDPOINT_BASE 保持一致 */
const DEFAULT_ENDPOINT = "https://push-e2e.test/ok";

type SeedStatus = "pending" | "sent" | "dead";

interface SeedBody {
  endpoint?: string;
  status?: SeedStatus;
  attemptCount?: number;
  dueInMs?: number;
  type?: string;
  withNotification?: boolean;
  withSubscription?: boolean;
  pushDisabled?: boolean;
  sentAtOffsetMs?: number;
  lastAttemptAtOffsetMs?: number;
  createdAtOffsetMs?: number;
}

function authOrThrow(request: NextRequest): Response | null {
  if (!isMockEnabled) {
    return jsonNoStore({ error: "Not found" }, { status: 404 });
  }
  if (!e2eBearerAuthorized(request.headers.get("authorization"))) {
    return jsonNoStore({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function isoAt(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** 把 mock 用户的 push 偏好设为指定值，其余偏好保持不变 */
async function setPushPreference(disabled: boolean): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("notification_settings")
    .eq("id", MOCK_USER_ID)
    .maybeSingle();
  const current = ((data as { notification_settings?: Record<string, unknown> } | null)
    ?.notification_settings ?? {}) as Record<string, unknown>;
  await admin
    .from("profiles")
    .update({ notification_settings: { ...current, pushNotifications: !disabled } })
    .eq("id", MOCK_USER_ID);
}

/** 插入通知行（种子场景可能故意省略，用于 notification-missing 死信） */
async function seedNotification(notificationId: string, type: string): Promise<void> {
  await createAdminClient()
    .from("notifications")
    .insert({
      id: notificationId,
      user_id: MOCK_USER_ID,
      type,
      title: "E2E Push 种子通知",
      body: "由 push-queue 端点注入，供 push-retry.spec 驱动重试链路。",
      link: null,
      metadata: null,
      email_sent: true,
      is_read: false,
    });
}

/** 插入 Push 订阅行；withSubscription=false 时返回一个悬空 id 模拟订阅已删除 */
async function seedSubscription(
  withSubscription: boolean,
  endpoint: string,
): Promise<string | null> {
  const subscriptionId = crypto.randomUUID();
  if (!withSubscription) return null;
  await createAdminClient()
    .from("push_subscriptions")
    .insert({
      id: subscriptionId,
      user_id: MOCK_USER_ID,
      endpoint,
      p256dh: "e2e-p256dh",
      auth: "e2e-auth",
      user_agent: "e2e",
    });
  return subscriptionId;
}

function parseBody(raw: string): SeedBody {
  try {
    return JSON.parse(raw) as SeedBody;
  } catch {
    return {};
  }
}

/**
 * 拼出 `push_delivery_attempts` 的种子行。
 *
 * 单独成函数有两个原因：POST 里已经把鉴权、三类种子与插入串在一起，再往里塞六个默认值分支就顶到
 * ESLint 的复杂度上限；而这张表的默认值语义（哪个偏移缺省等于「此刻」）本来就该写在一处。
 */
function attemptSeedRow(input: {
  attemptId: string;
  notificationId: string;
  subscriptionId: string | null;
  endpoint: string;
  status: SeedStatus;
  attemptCount: number;
  body: SeedBody;
}) {
  const { body, status } = input;
  return {
    id: input.attemptId,
    notification_id: input.notificationId,
    user_id: MOCK_USER_ID,
    // 订阅缺失场景需要一个「存在但查不到」的 id，才能走到 subscription-missing
    push_subscription_id: input.subscriptionId ?? crypto.randomUUID(),
    endpoint: input.endpoint,
    status,
    attempt_count: input.attemptCount,
    next_attempt_at: isoAt(body.dueInMs ?? -1000),
    created_at: isoAt(body.createdAtOffsetMs ?? 0),
    sent_at: status === "sent" ? isoAt(body.sentAtOffsetMs ?? -1000) : null,
    last_attempt_at: status === "dead" ? isoAt(body.lastAttemptAtOffsetMs ?? -1000) : null,
  };
}

export async function POST(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;

  const body = parseBody(await request.text().catch(() => ""));
  const endpoint = body.endpoint ?? DEFAULT_ENDPOINT;
  const status: SeedStatus = body.status ?? "pending";
  const attemptCount = Math.max(0, Math.floor(body.attemptCount ?? 0));

  const notificationId = crypto.randomUUID();
  if (body.withNotification !== false) {
    await seedNotification(notificationId, body.type ?? "system");
  }
  if (body.pushDisabled !== undefined) {
    await setPushPreference(body.pushDisabled);
  }
  const subscriptionId = await seedSubscription(body.withSubscription !== false, endpoint);
  const attemptId = crypto.randomUUID();

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_delivery_attempts")
    .insert(attemptSeedRow({ attemptId, notificationId, subscriptionId, endpoint, status, body, attemptCount }));
  if (error) return jsonNoStore({ error: error.message }, { status: 500 });

  return jsonNoStore({ notificationId, subscriptionId, attemptId });
}

const ATTEMPT_COLUMNS = [
  "id",
  "status",
  "attempt_count",
  "failure_code",
  "next_attempt_at",
  "last_attempt_at",
  "sent_at",
  "notification_id",
  "push_subscription_id",
  "endpoint",
] as const;

export async function GET(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;

  const admin = createAdminClient();
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  let query = admin.from("push_delivery_attempts").select("*").order("created_at", {
    ascending: true,
  });
  if (endpoint) query = query.eq("endpoint", endpoint);
  const { data, error } = await query;
  if (error) return jsonNoStore({ error: error.message }, { status: 500 });

  const { data: subscriptions } = await admin
    .from("push_subscriptions")
    .select("id,endpoint")
    .eq("user_id", MOCK_USER_ID);

  const attempts = ((data ?? []) as Record<string, unknown>[]).map((row) =>
    Object.fromEntries(ATTEMPT_COLUMNS.map((column) => [column, row[column]])),
  );
  return jsonNoStore({
    total: attempts.length,
    attempts,
    subscriptions: subscriptions ?? [],
  });
}

export async function DELETE(request: NextRequest) {
  const unauth = authOrThrow(request);
  if (unauth) return unauth;

  const admin = createAdminClient();
  const results = [
    await admin.from("push_delivery_attempts").delete(),
    await admin.from("push_subscriptions").delete(),
    await admin.from("notifications").delete().eq("user_id", MOCK_USER_ID),
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    return jsonNoStore({ error: failed.error.message }, { status: 500 });
  }
  await setPushPreference(false);
  return jsonNoStore({ deleted: true });
}
