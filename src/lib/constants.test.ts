import { describe, it, expect } from "vitest";
import { ROUTES, SUBSCRIPTION_TIERS } from "./constants";
import fs from "node:fs";
import path from "node:path";


describe("ROUTES 完整性", () => {
  it("所有路由以 / 开头且无尾斜杠", () => {
    for (const [key, path] of Object.entries(ROUTES)) {
      if (typeof path !== "string") continue; // 嵌套对象由扁平化覆盖
      if (path.startsWith("http")) continue; // 外部绝对 URL（如 docsUrl）
      expect(path, key).toMatch(/^\//);
      expect(path.endsWith("/") && path !== "/", key).toBe(false);
    }
  });

  it("dashboard 子路由均挂在 /dashboard 下", () => {
    const dashRoutes = Object.entries(ROUTES).filter(([k]) => /team|project|apiKeys|admin|settings|profile|billing|analytics|notifications/i.test(k));
    expect(dashRoutes.length).toBeGreaterThan(5);
    for (const [key, path] of dashRoutes) {
      if (key !== "dashboard") expect(path.startsWith("/dashboard"), key).toBe(true);
    }
  });

  it("admin 子路由均在 /dashboard/admin 下", () => {
    for (const key of ["admin", "adminUsers", "adminAuditLogs", "adminWebhooks", "adminMessages"]) {
      const path = ROUTES[key as keyof typeof ROUTES];
      expect(path, key).toMatch(/^\/dashboard\/admin(?:\/|$)/);
    }
  });
});

describe("SUBSCRIPTION_TIERS 翻译完整性", () => {
  const loadPricing = (locale: string) =>
    JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../messages", locale, "pricing.json"), "utf8"),
    );

  it("每个 tier 的 feature 键在 en/zh 定价文案中均存在", () => {
    const en = loadPricing("en");
    const zh = loadPricing("zh-CN");
    for (const tier of Object.values(SUBSCRIPTION_TIERS)) {
      for (const featureKey of (tier as { features: readonly string[] }).features) {
        expect(en.features?.[featureKey], `en: ${featureKey}`).toBeTruthy();
        expect(zh.features?.[featureKey], `zh-CN: ${featureKey}`).toBeTruthy();
      }
    }
  });
});
