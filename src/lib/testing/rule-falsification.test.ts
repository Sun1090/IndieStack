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

  it("返回类型本身是对象字面量时，指的是**函数体**那个 {（实测 auditBilingualDocs）", () => {
    const inlineReturnType = `export function auditBilingualDocs(
  documents: readonly BilingualDocDocument[],
): { issues: BilingualDocIssue[]; pairs: string[]; facts: BilingualDocFacts } {
  const byPath = new Map(documents.map((doc) => [doc.path, doc.content]));
  return { issues: [], pairs: [], facts: { cronExpressions: [], utcTimes: [] } };
}
`;
    const result = neuterFunction(inlineReturnType, "auditBilingualDocs", "return EMPTY;");
    expect(result.changed).toBe(true);
    // 插在函数体第一行，而不是返回类型那个 { 里面。
    expect(result.source).toContain("facts: BilingualDocFacts } {\n  return EMPTY;\n");
    // 返回类型必须一个字都没动。
    expect(result.source).toContain(
      "): { issues: BilingualDocIssue[]; pairs: string[]; facts: BilingualDocFacts }",
    );
  });

  it("单行签名 + 对象字面量返回类型同样指对函数体", () => {
    const single = "export function f(xs: number[]): { issues: string[]; pairs: string[] } {\n  return { issues: [], pairs: [] };\n}\n";
    const result = neuterFunction(single, "f", "return EMPTY;");
    expect(result.source).toContain("] } {\n  return EMPTY;\n");
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

  it("失败明细里含 Tests 的测试名时，仍读真正的汇总行（实测 auditGateRuleTests）", () => {
    // vitest 有失败时先打印明细再打印汇总；明细行里有测试名，而这个名字里带 Tests
    // （`gate-rule-tests` 的判定函数叫 auditGateRuleTests）。不锚行首时它会抢在
    // 汇总行之前被匹配，于是 8 条红被判成「读不出」，一个真的会红的模块无法登记。
    const raw = [
      " RUN  v5.0.1 /repo",
      "",
      " FAIL   node  src/lib/release/gate-rule-tests.test.ts > auditGateRuleTests > 规则模块没有单测时报红并点名",
      "AssertionError: expected '' to contain 'RULE_MODULE_UNTESTED'",
      "",
      "      Tests  8 failed | 11 passed (19)",
      "   Start at  08:00:33",
    ].join("\n");
    const outcome = summarizeFalsification(TARGET, raw);
    expect(outcome.failedTests).toBe(8);
    expect(outcome.passedTests).toBe(11);
    expect(outcome.verdict).toBe("bites");
  });

  it("Test Files 那一行不会被当成 Tests 汇总行", () => {
    const raw = [" Test Files  1 failed (1)", "      Tests  3 failed | 2 passed (5)"].join("\n");
    expect(summarizeFalsification(TARGET, raw).failedTests).toBe(3);
  });

  it("模块加载失败（Tests no tests）读不出，且不会被当成通过", () => {
    const outcome = summarizeFalsification(
      TARGET,
      " Tests  no tests\n Test Files  1 failed (1)\n",
    );
    expect(outcome.verdict).toBe("unreadable");
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