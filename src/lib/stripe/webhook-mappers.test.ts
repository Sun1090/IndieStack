/**
 * Stripe Webhook 纯函数测试
 * 覆盖：订阅状态映射、Price ID → plan 映射
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Stripe } from "stripe";
import { mapStatus, mapPlan } from "@/lib/stripe/webhook-mappers";

describe("mapStatus()", () => {
  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["canceled", "canceled"],
    ["incomplete", "inactive"],
    ["incomplete_expired", "inactive"],
  ] as [Stripe.Subscription.Status, string][])("%s → %s", (input, expected) => {
    expect(mapStatus(input)).toBe(expected);
  });
});

describe("mapPlan()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function setPriceIds({ pro, enterprise }: { pro?: string; enterprise?: string }) {
    delete process.env.STRIPE_PRO_PRICE_ID;
    delete process.env.STRIPE_ENTERPRISE_PRICE_ID;
    if (pro) process.env.STRIPE_PRO_PRICE_ID = pro;
    if (enterprise) process.env.STRIPE_ENTERPRISE_PRICE_ID = enterprise;
  }

  it("Pro Price ID 映射为 pro", () => {
    setPriceIds({ pro: "price_pro" });
    expect(mapPlan("price_pro")).toBe("pro");
  });

  it("Enterprise Price ID 映射为 enterprise", () => {
    setPriceIds({ enterprise: "price_ent" });
    expect(mapPlan("price_ent")).toBe("enterprise");
  });

  it("未知 Price ID / 空 Price ID 回退为 free", () => {
    setPriceIds({});
    expect(mapPlan("price_unknown")).toBe("free");
    expect(mapPlan(null)).toBe("free");
    expect(mapPlan(undefined)).toBe("free");
  });
});
