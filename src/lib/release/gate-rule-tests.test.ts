import { describe, expect, it } from "vitest";
import {
  auditGateRuleTests,
  formatGateRuleTestIssues,
  isRuleModule,
  isRuleModuleCovered,
  moduleNameOf,
} from "./gate-rule-tests.ts";

const ALL_TESTS = [
  "src/lib/ui/state-rules.test.ts",
  "src/lib/i18n/translation-values-check.test.ts",
  "src/lib/release/bundle-freshness.test.ts",
  "src/components/shared/page-loading.test.tsx",
];

describe("moduleNameOf", () => {
  it("取最后一段，去掉扩展名与 .test/.spec 中缀", () => {
    expect(moduleNameOf("src/lib/ui/state-rules.ts")).toBe("state-rules");
    expect(moduleNameOf("src/lib/ui/state-rules.test.ts")).toBe("state-rules");
    expect(moduleNameOf("src/lib/ui/page-loading.spec.tsx")).toBe("page-loading");
    expect(moduleNameOf("state-rules.tsx")).toBe("state-rules");
  });
});

describe("isRuleModule", () => {
  it("判定逻辑模块算规则模块", () => {
    expect(isRuleModule("src/lib/ui/state-rules.ts")).toBe(true);
    expect(isRuleModule("src/lib/release/gate-wiring.ts")).toBe(true);
  });

  it("类型声明文件不算（types.ts / *.types.ts）", () => {
    expect(isRuleModule("src/lib/notifications/types.ts")).toBe(false);
    expect(isRuleModule("src/lib/supabase/database.types.ts")).toBe(false);
  });
});

describe("isRuleModuleCovered", () => {
  it("同名测试算覆盖", () => {
    expect(isRuleModuleCovered("src/lib/ui/state-rules.ts", ALL_TESTS)).toBe(true);
  });

  it("以规则模块名开头的测试也算覆盖（translation-values-check）", () => {
    expect(
      isRuleModuleCovered("src/lib/i18n/translation-values.ts", ALL_TESTS),
    ).toBe(true);
  });

  it("只有非测试文件不算覆盖", () => {
    expect(
      isRuleModuleCovered("src/lib/ui/state-rules.ts", ["src/lib/ui/state-rules.ts"]),
    ).toBe(false);
  });

  it("别的模块的测试不算覆盖", () => {
    expect(isRuleModuleCovered("src/lib/ui/tokens.ts", ALL_TESTS)).toBe(false);
  });

  it("前缀相同但不是分隔边界的名字不算覆盖", () => {
    // `state-rules-extra` 是另一个模块，不该被 `state-rules` 的测试误认
    expect(
      isRuleModuleCovered("src/lib/ui/state-rules-extra.ts", [
        "src/lib/ui/state-rules.test.ts",
      ]),
    ).toBe(false);
  });
});

describe("auditGateRuleTests", () => {
  it("全部规则模块都有单测时不报错", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:states", ruleModules: ["src/lib/ui/state-rules.ts"] },
        { name: "check:fields", ruleModules: ["src/lib/ui/form-field-rules.ts"] },
      ],
      testFiles: [...ALL_TESTS, "src/lib/ui/form-field-rules.test.ts"],
    });
    expect(report.errors).toEqual([]);
  });

  it("规则模块没有单测时报红并点名", () => {
    const report = auditGateRuleTests({
      gates: [{ name: "check:states", ruleModules: ["src/lib/ui/state-rules.ts"] }],
      testFiles: ["src/lib/release/bundle-freshness.test.ts"],
    });
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].code).toBe("RULE_MODULE_UNTESTED");
    expect(report.errors[0].subject).toBe("src/lib/ui/state-rules.ts");
  });

  it("同一个规则模块被多条门禁引用时只报一次", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:a", ruleModules: ["src/lib/ui/state-rules.ts"] },
        { name: "check:b", ruleModules: ["src/lib/ui/state-rules.ts"] },
      ],
      testFiles: ["src/lib/release/bundle-freshness.test.ts"],
    });
    expect(report.errors).toHaveLength(1);
  });

  it("一条规则模块都没检出时报红（提取失效应出声）", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:perf", ruleModules: [] },
        { name: "check:states", ruleModules: [] },
      ],
      testFiles: ALL_TESTS,
    });
    expect(report.errors.map((e) => e.code)).toContain("NO_RULE_MODULE_DETECTED");
  });

  it("判定内联在脚本里的门禁现在**报错**（从「被计数」升级为「一律失败」）", () => {
    // 这条规则刚加上时全仓库还有 10 条内联门禁，只能计数；搬完后归零，于是改成硬失败——
    // 一个能悄悄涨回去的绿色数字，不如一条会红的规则。
    const report = auditGateRuleTests({
      gates: [
        { name: "check:perf", ruleModules: [] },
        { name: "check:states", ruleModules: ["src/lib/ui/state-rules.ts"] },
      ],
      testFiles: ALL_TESTS,
    });
    expect(report.errors.map((e) => e.code)).toEqual(["INLINE_GATE_REINTRODUCED"]);
    // 必须点名是哪几条，否则「有条内联门禁」这件事仍然不好查
    expect(report.errors[0].subject).toBe("check:perf");
    expect(report.stats).toEqual({
      totalGates: 2,
      gatedGates: 1,
      inlineGates: 1,
      ruleModules: 1,
    });
  });

  it("全部走规则模块时（今天的状态）不报错", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:states", ruleModules: ["src/lib/ui/state-rules.ts"] },
        { name: "check:fields", ruleModules: ["src/lib/ui/form-field-rules.ts"] },
      ],
      testFiles: [...ALL_TESTS, "src/lib/ui/form-field-rules.test.ts"],
    });
    expect(report.errors).toEqual([]);
    expect(report.stats.inlineGates).toBe(0);
  });

  it("多条内联门禁一次全部点名", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:a", ruleModules: ["src/lib/ui/state-rules.ts"] },
        { name: "check:b", ruleModules: [] },
        { name: "check:c", ruleModules: [] },
      ],
      testFiles: ALL_TESTS,
    });
    expect(report.errors[0].subject).toBe("check:b, check:c");
  });

  it("只被类型文件引用的门禁不参与「检出模块数」", () => {
    // 提取启发式会把 types.ts 一并扫出来；它们不构成规则模块，所以不该把
    // 「检出 0 个模块」的失败封闭触发掉
    const report = auditGateRuleTests({
      gates: [{ name: "check:notifications", ruleModules: ["src/lib/notifications/types.ts"] }],
      testFiles: ALL_TESTS,
    });
    // 这个 fixture 里所有门禁都是内联的，所以两条规则**都**该触发：
    // 「一条规则模块都没检出」与「有内联门禁」。用 contains 而不是 toEqual，
    // 免得以后加规则时这个用例变成一个必须同步更新的负担。
    expect(report.errors.map((e) => e.code)).toContain("NO_RULE_MODULE_DETECTED");
  });

  it("统计覆盖了全部门禁而不是只统计有规则模块的那些", () => {
    const report = auditGateRuleTests({
      gates: [
        { name: "check:a", ruleModules: ["src/lib/ui/state-rules.ts"] },
        { name: "check:b", ruleModules: [] },
        { name: "check:c", ruleModules: [] },
      ],
      testFiles: ALL_TESTS,
    });
    expect(report.stats.totalGates).toBe(3);
    expect(report.stats.inlineGates).toBe(2);
  });
});

describe("formatGateRuleTestIssues", () => {
  it("逐条打印，code 与对象都出现", () => {
    const report = auditGateRuleTests({
      gates: [{ name: "check:states", ruleModules: ["src/lib/ui/state-rules.ts"] }],
      testFiles: [],
    });
    const text = formatGateRuleTestIssues(report.errors);
    expect(text).toContain("RULE_MODULE_UNTESTED");
    expect(text).toContain("src/lib/ui/state-rules.ts");
  });

  it("没有问题时输出空字符串", () => {
    expect(formatGateRuleTestIssues([])).toBe("");
  });
});
