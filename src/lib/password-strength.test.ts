import { describe, expect, it } from "vitest";
import { scorePassword, STRENGTH_LABEL_KEYS } from "./password-strength";

describe("scorePassword()", () => {
  it("空密码评 0 级", () => {
    expect(scorePassword("")).toBe(0);
  });

  it("短密码评得比满分低", () => {
    expect(scorePassword("abc")).toBeLessThan(4);
  });

  it("长且混合字符能拿到满分", () => {
    expect(scorePassword("Abcdefg12345!@")).toBe(4);
  });

  it("STRENGTH_LABEL_KEYS 与等级一一对应", () => {
    expect(STRENGTH_LABEL_KEYS).toHaveLength(4);
  });
});
