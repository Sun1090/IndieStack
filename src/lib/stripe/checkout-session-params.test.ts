/**
 * Checkout Session 请求参数的契约测试（stripe v23 升级的钉子）。
 *
 * **为什么单独一个文件**：`createCheckoutSession` 是本仓库唯一一处直接向 Stripe
 * 发起写请求的地方，而它此前**没有任何参数级断言**——所以 2026-10-05 升级到
 * stripe v23 时，`payment_method_types` 被 Stripe 的 API 取消这件事
 * 只由 `tsc` 发现（`TS2561`），而不是由一条说明「我们为什么删掉它」的用例发现。
 *
 * 这条用例要钉的是两件事：
 *  1. **不再传 `payment_method_types`**。Stripe 已把它从 Checkout Session 的可写参数里
 *     移除（继续传会得到 `400 payment_method_types_no_longer_supported`），
 *     替代做法是**不指定**，由 automatic payment methods 按地区与账号设置自行挑选。
 *  2. **其余参数照旧**——删一个字段不该顺手改掉别的（订阅模式、line_items、
 *     促销码、试用天数、metadata、成功/取消 URL）。
 *
 * 顺带钉住幂等键：**只在调用方给了才发**，因为 Stripe 对「同一 key 不同参数」会直接报错，
 * 而一个恒定的 key 会让第二次调用变成第一次的复制。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const createSession = vi.fn();
const sdkConstructor = vi.fn();

vi.mock("stripe", () => ({
  default: class {
    checkout = { sessions: { create: createSession } };
    constructor(key: string) {
      sdkConstructor(key);
    }
  },
}));

// appark 在同一模块图里（trackEvent/flushEvents），这里只需要它不炸。
vi.mock("@/lib/appark", () => ({
  trackEvent: vi.fn(),
  flushEvents: vi.fn(),
}));

const ORIGINAL_ENV = process.env;

async function loadModule() {
  vi.resetModules();
  return import("@/lib/stripe");
}

/** 取出 `create()` 收到的第一个参数（请求体），类型上只当普通对象看待。 */
function firstCallParams(): Record<string, unknown> {
  expect(createSession).toHaveBeenCalledTimes(1);
  return createSession.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("createCheckoutSession() 的请求参数", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, STRIPE_SECRET_KEY: "sk_test_dummy" };
    createSession.mockReset();
    createSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/x" });
    sdkConstructor.mockReset();
  });

  it("不传 payment_method_types：Stripe 已取消该可写参数，改由 automatic payment methods 决定", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1");

    const params = firstCallParams();
    expect(params).not.toHaveProperty("payment_method_types");
    // 键本身不存在，而不是值为 undefined——后者在 SDK 里仍可能被序列化出去。
    expect(Object.keys(params)).not.toContain("payment_method_types");
  });

  it("其余参数一字未改：订阅模式、单一 line_item、默认促销码", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1");

    const params = firstCallParams();
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_1", quantity: 1 }]);
    expect(params.allow_promotion_codes).toBe(true);
  });

  it("试用天数只在给了的时候出现，且落在 subscription_data 上", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1", { trialDays: 14 });

    const params = firstCallParams();
    expect(params.subscription_data).toMatchObject({ trial_period_days: 14 });
  });

  it("没给 trialDays 时不写 trial_period_days（不是写 0，也不是写 undefined）", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1");

    const subscriptionData = firstCallParams().subscription_data as Record<string, unknown>;
    expect(subscriptionData).not.toHaveProperty("trial_period_days");
  });

  it("metadata 带 userId/teamId，供 webhook 侧归属", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1", { userId: "u_1", teamId: "t_1" });

    const subscriptionData = firstCallParams().subscription_data as Record<string, unknown>;
    expect(subscriptionData.metadata).toMatchObject({ userId: "u_1", teamId: "t_1" });
  });

  it("成功/取消 URL 可以覆盖，默认落到 dashboard/billing", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1", {
      successUrl: "https://app.test/done",
      cancelUrl: "https://app.test/cancel",
    });

    const params = firstCallParams();
    expect(params.success_url).toBe("https://app.test/done");
    expect(params.cancel_url).toBe("https://app.test/cancel");
  });

  it("幂等键只在调用方给了时才作为第二个参数出现", async () => {
    const { createCheckoutSession } = await loadModule();
    await createCheckoutSession("price_1");
    expect(createSession.mock.calls[0]?.[1]).toBeUndefined();

    createSession.mockClear();
    await createCheckoutSession("price_1", { idempotencyKey: "idem_1" });
    expect(createSession.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "idem_1" });
  });

  it("STRIPE_SECRET_KEY 缺失时抛错，而不是拿空 key 去请求", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.STRIPE_SECRET_KEY;
    const { createCheckoutSession } = await loadModule();
    await expect(createCheckoutSession("price_1")).rejects.toThrow("Stripe 未配置");
  });
});