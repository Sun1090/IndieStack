import { describe, it, expect } from "vitest";
import { ok, fail, type ActionResult } from "./action-result";

describe("ActionResult", () => {
  it("ok() 无数据时不含 data 字段", () => {
    const result = ok();
    expect(result).toEqual({ ok: true });
  });

  it("ok() 携带数据", () => {
    expect(ok({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
  });

  it("fail() 携带 i18n 错误键", () => {
    expect(fail("notAuthenticated")).toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("判别联合可收窄类型", () => {
    const results: ActionResult<{ name: string }>[] = [ok({ name: "alice" }), fail("boom")];
    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes[0].data?.name).toBe("alice");
    expect(typeof failures[0].error).toBe("string");
  });
});
