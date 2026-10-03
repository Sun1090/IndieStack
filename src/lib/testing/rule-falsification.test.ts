import { describe, expect, it } from "vitest";
import {
  RULE_FALSIFICATION_TARGETS,
  formatFalsificationOutcome,
  neuterFunction,
  stripAnsi,
  summarizeFalsification,
  type FalsificationTarget,
} from "./rule-falsification.ts";

const TARGET: FalsificationTarget = {
  file: "src/lib/security/rls-coverage.ts",
  function: "inspectRlsCoverage",
  neuteredReturn: "return [];",
  testFile: "src/lib/security/rls-coverage.test.ts",
};

const SOURCE = `export function inspectRlsCoverage(
  sources: SecuritySource[],
): RlsCoverageIssue[] {
  const issues: RlsCoverageIssue[] = [];
  return issues;
}
`;

describe("neuterFunction()", () => {
  it("在函数体第一行插入中性化语句", () => {
    const result = neuterFunction(SOURCE, "inspectRlsCoverage", "return [];");
    expect(result.changed).toBe(true);
    expect(result.source).toContain("): RlsCoverageIssue[] {\n  return [];\n");
  });

  it("签名跨行时也指对函数体（靠括号配对，不靠「下一行以 { 开头」）", () => {
    const tricky = `export function pick(\n  a: string,\n): string {\n  return a;\n}\n`;
    const result = neuterFunction(tricky, "pick", 'return "";');
    const mutationAt = result.source.indexOf('return "";');
    const originalAt = result.source.indexOf("return a;");
    expect(result.source).toContain('): string {\n  return "";');
    // 中性化语句必须在原函数体第一行之前，否则它什么也拦不住。
    expect(mutationAt).toBeGreaterThan(-1);
    expect(mutationAt).toBeLessThan(originalAt);
  });

  it("函数名找不到时 changed=false（调用方据此报错，而不是当成「通过」）", () => {
    expect(neuterFunction(SOURCE, "notThere", "return [];").changed).toBe(false);
  });

  it("没有导出（内部 helper）时不改", () => {
    const internal = "function helper() {\n  return 1;\n}\n";
    expect(neuterFunction(internal, "helper", "return 0;").changed).toBe(false);
  });
});

describe("stripAnsi()", () => {
  it("去掉 vitest 输出里的转义序列", () => {
    const raw = "[2m[22m Tests [1m[22m       [1m[22m8 failed[1m[22m";
    expect(stripAnsi(raw)).toContain("Tests");
    expect(stripAnsi(raw)).not.toContain("");
  });
});

describe("summarizeFalsification()", () => {
  it("读到变红条数时判 bites", () => {
    const outcome = summarizeFalsification(TARGET, " Tests       8 failed | 6 passed\n");
    expect(outcome.failedTests).toBe(8);
    expect(outcome.passedTests).toBe(6);
    expect(outcome.verdict).toBe("bites");
  });

  it("带 ANSI 的真实输出也必须读得出数字", () => {
    // #194 与本轮都栽在这里：转义序列夹在 `Tests` 与数字之间，正则匹配不到，
    // 于是六个全部变红的模块被读成六个全部存活。
    const colored = "[2m[22m Tests [2m[22m       [1m[22m8 failed[1m[22m | 6 passed";
    expect(summarizeFalsification(TARGET, colored).verdict).toBe("bites");
  });

  it("读不出数字时给 unreadable，绝不给 survived", () => {
    // 这是那次事故的形状：把「不知道」读成「没问题」。
    const outcome = summarizeFalsification(TARGET, "vitest crashed before printing a summary");
    expect(outcome.verdict).toBe("unreadable");
    expect(outcome.verdict).not.toBe("survived");
    expect(outcome.failedTests).toBeNull();
  });

  it("真的全绿时判 survived（这一格必须是真结论，不能被上面的读不出占用）", () => {
    expect(summarizeFalsification(TARGET, " Tests 14 passed (14)\n").verdict).toBe("survived");
  });
});

describe("formatFalsificationOutcome()", () => {
  it("三档分别写清，不把「读不出」排进通过", () => {
    expect(formatFalsificationOutcome(summarizeFalsification(TARGET, " Tests 8 failed | 6 passed"))).toContain(
      "✅ 会红",
    );
    expect(formatFalsificationOutcome(summarizeFalsification(TARGET, " Tests 14 passed"))).toContain(
      "❌ 存活",
    );
    expect(formatFalsificationOutcome(summarizeFalsification(TARGET, "boom"))).toContain("⚠️ 读不出");
  });
});

describe("RULE_FALSIFICATION_TARGETS", () => {
  it("每条都指到真实的文件与导出函数（登记表不是「打算核对」的清单）", () => {
    expect(RULE_FALSIFICATION_TARGETS.length).toBeGreaterThan(0);
    for (const target of RULE_FALSIFICATION_TARGETS) {
      expect(target.file).toMatch(/^src\/lib\/.+\.ts$/);
      expect(target.testFile).toMatch(/\.test\.ts$/);
      expect(target.neuteredReturn).toMatch(/^return /);
    }
  });

  it("同一个函数不会被登记两次（重复会让表里的证据条数虚高）", () => {
    const keys = RULE_FALSIFICATION_TARGETS.map((target) => `${target.file}#${target.function}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});