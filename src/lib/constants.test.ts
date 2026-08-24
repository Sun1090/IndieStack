import { describe, it, expect } from "vitest";
import { ROUTES } from "./constants";


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
});
