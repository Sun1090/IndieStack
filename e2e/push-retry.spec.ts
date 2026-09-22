/**
 * Web Push 重试链路 E2E（v0.8.0）
 *
 * 通过 mock-only 的 `/api/e2e/push-queue` 种子端点驱动真实 cron 路由
 * （`POST /api/cron/push-retry`），覆盖投递引擎的全部分支：
 *   成功 → sent / 瞬时失败 → 退避重试 / 超过上限 → 死信 / 超过行龄上界 → max-age 死信 /
 *   404-410 → 撤销订阅 / 订阅缺失 / 用户关闭 Push / 通知缺失 /
 *   终态保留策略清理。
 *
 * 全部 mock：端点路径决定传输层结果（/ok、/transient、/timeout、/gone），
 * 不需要真实数据库、VAPID 凭据或 push service。
 */

import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

const E2E_BEARER = "e2e-bearer-token";
const CRON_SECRET = "e2e-cron-secret";
import { appUrl } from "./support/base-url";
const OK = "https://push-e2e.test/ok";
const TRANSIENT = "https://push-e2e.test/transient";
const GONE = "https://push-e2e.test/gone";

const DAY_MS = 24 * 60 * 60 * 1000;

interface AttemptRow {
  id: string;
  status: string;
  attempt_count: number;
  failure_code: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  notification_id: string;
  push_subscription_id: string | null;
  endpoint: string;
}

interface QueueState {
  total: number;
  attempts: AttemptRow[];
  subscriptions: { id: string; endpoint: string }[];
}

interface CronResult {
  pulled: number;
  sent: number;
  retried: number;
  dead: number;
  revoked: number;
  pruned: { sent: number; dead: number } | null;
}

const auth = { authorization: `Bearer ${E2E_BEARER}` };

test.describe("Web Push 重试链路 (F06)", () => {
  test.describe.configure({ mode: "serial" });
  let api: APIRequestContext;

  async function reset(): Promise<void> {
    await api.delete(`${appUrl()}/api/e2e/push-queue`, { headers: auth });
  }

  async function seed(body: Record<string, unknown>): Promise<void> {
    const res = await api.post(`${appUrl()}/api/e2e/push-queue`, {
      headers: auth,
      data: body,
    });
    expect(res.ok(), `seed failed: ${await res.text()}`).toBeTruthy();
  }

  async function queue(endpoint?: string): Promise<QueueState> {
    const url = endpoint
      ? `${appUrl()}/api/e2e/push-queue?endpoint=${encodeURIComponent(endpoint)}`
      : `${appUrl()}/api/e2e/push-queue`;
    const res = await api.get(url, { headers: auth });
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as QueueState;
  }

  async function runCron(secret = CRON_SECRET): Promise<{ status: number; body: CronResult }> {
    const res = await api.post(`${appUrl()}/api/cron/push-retry`, {
      headers: { "x-cron-secret": secret },
    });
    return { status: res.status(), body: (await res.json()) as CronResult };
  }

  test.beforeAll(async ({ playwright }) => {
    api = await pwRequest.newContext({ baseURL: appUrl() });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test.beforeEach(async () => {
    await reset();
  });

  test("鉴权：缺少 cron secret 返回 401，mock 关闭时 E2E 端点不存在", async () => {
    const unauthorized = await runCron("wrong-secret");
    expect(unauthorized.status).toBe(401);

    const e2eUnauthorized = await api.get(`${appUrl()}/api/e2e/push-queue`);
    expect(e2eUnauthorized.status()).toBe(401);
  });

  test("空队列：全零计数且清理为 0", async () => {
    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body).toMatchObject({ pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 });
    expect(body.pruned).toEqual({ sent: 0, dead: 0 });
  });

  test("成功投递：pending → sent 并记录尝试次数", async () => {
    await seed({ endpoint: OK, status: "pending", dueInMs: -1000 });

    const { status, body } = await runCron();
    expect(status).toBe(200);
    expect(body).toMatchObject({ pulled: 1, sent: 1, retried: 0, dead: 0, revoked: 0 });

    const rows = (await queue(OK)).attempts;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempt_count: 1, failure_code: null });
    expect(rows[0].sent_at).not.toBeNull();
  });

  test("瞬时失败：保持 pending 并按指数退避重排", async () => {
    await seed({ endpoint: TRANSIENT, status: "pending", dueInMs: -1000 });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 1, dead: 0, revoked: 0 });

    const [row] = (await queue(TRANSIENT)).attempts;
    expect(row).toMatchObject({ status: "pending", attempt_count: 1, failure_code: "network" });
    // 首次失败退避 60s：next_attempt_at 必须被推到未来，避免 cron 空转热循环
    expect(new Date(row.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  test("超过重试上限：第三次失败进入死信", async () => {
    await seed({ endpoint: TRANSIENT, status: "pending", attemptCount: 2, dueInMs: -1000 });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });

    const [row] = (await queue(TRANSIENT)).attempts;
    expect(row).toMatchObject({ status: "dead", attempt_count: 3, failure_code: "max-attempts" });
  });

  test("行龄超过上界：计数没到上限也进死信（max-age）", async () => {
    // 这就是「重排回执一直写不进去」的样子：8 天前入队，attempt_count 还停在 0。
    // 没有行龄上界的话，这一行会永远占在按到期时间升序拉取的队首。
    await seed({
      endpoint: TRANSIENT,
      status: "pending",
      attemptCount: 0,
      dueInMs: -1000,
      createdAtOffsetMs: -8 * DAY_MS,
    });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });

    const [row] = (await queue(TRANSIENT)).attempts;
    expect(row).toMatchObject({ status: "dead", failure_code: "max-age" });
  });

  test("端点永久失效（410）：死信并撤销本地订阅", async () => {
    await seed({ endpoint: GONE, status: "pending", dueInMs: -1000 });

    const { body } = await runCron();
    // 失效端点同时计入 dead 与 revoked，便于按端点质量告警
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 1 });

    const state = await queue(GONE);
    expect(state.attempts[0]).toMatchObject({
      status: "dead",
      attempt_count: 1,
      failure_code: "subscription-gone",
    });
    expect(state.subscriptions.map((s) => s.endpoint)).not.toContain(GONE);
  });

  test("订阅记录缺失：死信并计入失效端点", async () => {
    await seed({ endpoint: OK, status: "pending", dueInMs: -1000, withSubscription: false });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 1 });

    const [row] = (await queue(OK)).attempts;
    expect(row).toMatchObject({ status: "dead", failure_code: "subscription-missing" });
  });

  test("用户关闭 Push：不再打扰，直接死信", async () => {
    await seed({ endpoint: OK, status: "pending", dueInMs: -1000, pushDisabled: true });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1, revoked: 0 });

    const [row] = (await queue(OK)).attempts;
    expect(row).toMatchObject({ status: "dead", failure_code: "push-disabled" });
  });

  test("通知行缺失：死信而非静默丢弃", async () => {
    await seed({ endpoint: OK, status: "pending", dueInMs: -1000, withNotification: false });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 1, sent: 0, retried: 0, dead: 1 });

    const [row] = (await queue(OK)).attempts;
    expect(row).toMatchObject({ status: "dead", failure_code: "notification-missing" });
  });

  test("保留策略：清理过期终态行，未到期的 pending 与终态行保留", async () => {
    await seed({ endpoint: OK, status: "sent", sentAtOffsetMs: -8 * DAY_MS });
    await seed({ endpoint: OK, status: "sent", sentAtOffsetMs: -1 * DAY_MS });
    await seed({ endpoint: OK, status: "dead", lastAttemptAtOffsetMs: -31 * DAY_MS });
    await seed({ endpoint: OK, status: "dead", lastAttemptAtOffsetMs: -29 * DAY_MS });
    // 未到期：worker 不该拉取（保留策略也不该清理 pending）
    await seed({ endpoint: OK, status: "pending", dueInMs: 60 * 60 * 1000 });

    const { body } = await runCron();
    expect(body).toMatchObject({ pulled: 0, sent: 0, retried: 0, dead: 0, revoked: 0 });
    expect(body.pruned).toEqual({ sent: 1, dead: 1 });

    const rows = (await queue(OK)).attempts;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.status).sort()).toEqual(["dead", "pending", "sent"]);
  });
});
