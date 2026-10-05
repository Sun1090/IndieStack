/**
 * `pnpm smoke:production` 的 `liveness` 步骤行为单测。
 *
 * **为什么这一步要有单测**：它断言的不是「200」，而是**存活探针没有被并回就绪探针**
 * ——具体是「返回体里没有 `checks` / `version` / `commit` / `uptime`」。
 * 这个性质没有任何别的门禁看着：哪天有人觉得「两条端点重复，合成一条吧」，
 * `live.test.ts` 与就绪路由的用例**各自都还是绿的**（它们各自都对），
 * 只有这一条会红——所以它必须被独立地钉住，否则就是一个只在生产上才看得见的性质。
 *
 * 这里不联网：用假 `fetchImpl` 把三种读法喂进去。
 */
import { describe, expect, it } from "vitest";
import { checkLiveness } from "../../../scripts/production-smoke.js";

/** 造一个只会应答 `/api/health/live` 的假 fetch。 */
function stubFetch(body: unknown, status = 200) {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
}

const BASE = new URL("http://localhost:3000");
const OPTIONS = { timeoutMs: 1000 };

describe("smoke:production 的 liveness 步骤", () => {
  it("干净的存活返回体通过", async () => {
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: stubFetch({ status: "ok", timestamp: "2026-10-05T00:00:00.000Z" }),
    });
    expect(check.name).toBe("liveness");
    expect(check.passed).toBe(true);
  });

  it("返回体混入依赖明细/构建身份就判红，并点名是哪几个字段", async () => {
    // 这正是「把 live 并回 readiness」之后生产会返回的形状。
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: stubFetch({
        status: "ok",
        timestamp: "2026-10-05T00:00:00.000Z",
        version: "0.11.0",
        commit: "4139cec",
        checks: { supabase: { status: "ok" } },
      }),
    });
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("checks");
    expect(check.detail).toContain("version");
    expect(check.detail).toContain("commit");
  });

  it("uptime 也算泄露：它会暴露实例启动时刻", async () => {
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: stubFetch({ status: "ok", timestamp: "t", uptime: 42 }),
    });
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("uptime");
  });

  it("status 不是 ok（哪怕 200）也判红", async () => {
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: stubFetch({ status: "error", timestamp: "t" }),
    });
    expect(check.passed).toBe(false);
  });

  it("非 200 判红", async () => {
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: stubFetch({ status: "ok", timestamp: "t" }, 503),
    });
    expect(check.passed).toBe(false);
    expect(check.status).toBe(503);
  });

  it("返回体不是 JSON 时判红而不是抛错（冒烟必须跑完并给出结论）", async () => {
    const check = await checkLiveness(BASE, {
      ...OPTIONS,
      fetchImpl: async () => new Response("<html>oops</html>", { status: 200 }),
    });
    expect(check.passed).toBe(false);
  });
});