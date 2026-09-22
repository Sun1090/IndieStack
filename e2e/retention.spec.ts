import { expect, test } from "@playwright/test";

/**
 * 保留期清理 worker 的入口回归（`/api/cron/retention`）。
 *
 * 这里只证明两件事：鉴权按预期拒绝，以及**部署里的这条路由真的可达**——
 * `check:cron-contract` 能证明文件存在、被调度、指标接线，但它看不见 404。
 *
 * 局限：mock 模式的 RPC 不落 SQL，六个清理函数在测试里都是空操作，
 * 因此本文件不证明「过期行真的被删了」。删除语义由迁移里的函数体
 * 与 `src/lib/repositories/retention.test.ts` 的调度清单契约保证。
 */

import { appUrl } from "./support/base-url";
const CRON_SECRET = "e2e-cron-secret";

test.describe("数据保留期清理 cron", () => {
  test("缺少凭据返回 401", async ({ request }) => {
    const response = await request.post(`${appUrl()}/api/cron/retention`);
    expect(response.status()).toBe(401);
  });

  test("错误 secret 返回 401，不回显凭据", async ({ request }) => {
    const response = await request.post(`${appUrl()}/api/cron/retention`, {
      headers: { "x-cron-secret": "wrong-secret" },
    });
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("wrong-secret");
  });

  test("携带 cron secret 时路由可达，响应只有脱敏计数", async ({ request }) => {
    const response = await request.post(`${appUrl()}/api/cron/retention`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["failed", "orphans", "ran", "unownedOrphans"]);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
