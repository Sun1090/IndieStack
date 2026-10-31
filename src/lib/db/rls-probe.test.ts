import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NON_PROBE_FILES,
  auditProbeInventory,
  countExpectations,
  decidePrerequisite,
  formatProbeIssues,
  hasAssertion,
  summarizeProbeRun,
} from "./rls-probe";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("decidePrerequisite", () => {
  it("三个二进制齐了就往下走，且不带任何话", () => {
    const decision = decidePrerequisite({ missingBins: [], requireFlag: undefined });
    expect(decision.action).toBe("proceed");
    expect(decision.message).toBe("");
  });

  it("缺二进制且没设 RLS_PROBE_REQUIRE 时跳过，并点名缺的是哪个", () => {
    const decision = decidePrerequisite({ missingBins: ["initdb", "psql"], requireFlag: undefined });
    expect(decision.action).toBe("skip");
    expect(decision.message).toContain("initdb / psql");
  });

  /**
   * 跳过的措辞是判定的一部分：只说「已跳过」会让读日志的人以为 RLS 验过了，
   * 而这次其实只跑了静态扫描。所以这里钉的不是措辞好看，是**不许漏掉这句限定**。
   */
  it("跳过时必须写明这一层没有被执行验证", () => {
    const decision = decidePrerequisite({ missingBins: ["pg_ctl"], requireFlag: "" });
    expect(decision.action).toBe("skip");
    expect(decision.message).toContain("没有被执行验证");
    expect(decision.message).toContain("check:rls");
  });

  it("RLS_PROBE_REQUIRE=1 时同样的缺失按失败处理，不是跳过", () => {
    const decision = decidePrerequisite({ missingBins: ["psql"], requireFlag: "1" });
    expect(decision.action).toBe("fail");
    expect(decision.message).toContain("RLS_PROBE_REQUIRE=1");
  });

  it("只有字面量 1 才算强制：0 / true / 空串都不算", () => {
    for (const flag of ["0", "true", "yes", "", undefined]) {
      expect(decidePrerequisite({ missingBins: ["psql"], requireFlag: flag }).action).toBe("skip");
    }
  });
});

describe("countExpectations", () => {
  it("只数代码位的调用", () => {
    const sql = ["select probe.expect('a', 1, 1);", "select probe.expect('b', 0, 0);"].join("\n");
    expect(countExpectations(sql)).toBe(2);
  });

  /**
   * 反例：`000_helpers.sql` 的注释里就写着 `probe.expect(...)` 的用法说明。
   * 不抹注释的话，一个纯注释空壳文件能把自己撑成「验了一件事」。
   */
  it("注释里的 probe.expect( 不算数", () => {
    const sql = ["-- 用法：select probe.expect('名字', rows, want);", "select 1;"].join("\n");
    expect(countExpectations(sql)).toBe(0);
  });

  /**
   * 定义行 `create or replace function probe.expect(...)` 里也含 `probe.expect(`，
   * 本模块不去区分定义与调用——它靠的是**把 `000_helpers.sql` 从探针里排除**。
   * 这条断言钉的是这条依赖：计数规则本身不认得定义，排除动作必须有人做。
   */
  it("计数分不清定义与调用，所以 000_helpers.sql 必须被排除", () => {
    expect(NON_PROBE_FILES).toContain("000_helpers.sql");
    expect(countExpectations("create or replace function probe.expect(p_case text)")).toBe(1);
  });
});

describe("hasAssertion", () => {
  it("认得 probe.verify 调用", () => {
    expect(hasAssertion("select probe.verify('矩阵');")).toBe(true);
  });

  it("注释里的 probe.verify( 不算", () => {
    expect(hasAssertion("-- 结尾记得 select probe.verify('x');")).toBe(false);
  });
});

describe("auditProbeInventory", () => {
  const helpers = {
    name: "000_helpers.sql",
    text: [
      "create or replace function probe.expect(p_case text) returns void",
      "create or replace function probe.verify(p_title text) returns void",
    ].join("\n"),
  };

  const goodProbe = {
    name: "042_example_probe.sql",
    text: ["select probe.expect('读自己的行', 1, 1);", "select probe.verify('示例');"].join("\n"),
  };

  it("一个合格探针 + 夹具：没有意见，夹具不进用例统计", () => {
    const report = auditProbeInventory([helpers, goodProbe]);
    expect(report.issues).toEqual([]);
    expect(report.stats).toEqual({ probeFiles: 1, cases: 1 });
  });

  it("一个探针都没有时报 NO_PROBES", () => {
    const report = auditProbeInventory([helpers]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["NO_PROBES"]);
  });

  it("缺夹具时报 MISSING_HELPERS（否则探针会以「函数不存在」失败，看着像策略问题）", () => {
    const report = auditProbeInventory([goodProbe]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["MISSING_HELPERS"]);
  });

  /**
   * 下面两条是这门禁真正存在的理由：这两种文件在 psql 下**都退 0**。
   */
  it("只登记不断言的探针被红（登记的行没人读，psql 仍退 0）", () => {
    const report = auditProbeInventory([
      helpers,
      { name: "043_forgot_verify.sql", text: "select probe.expect('某条', 1, 1);" },
    ]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "PROBE_WITHOUT_ASSERT", subject: "043_forgot_verify.sql" });
  });

  it("只断言不登记的探针被红（空表上 failures=0，会打印「0 条全部符合期望」）", () => {
    const report = auditProbeInventory([
      helpers,
      { name: "044_empty_matrix.sql", text: "select probe.verify('空矩阵');" },
    ]);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "PROBE_WITHOUT_EXPECTATION", subject: "044_empty_matrix.sql" });
  });

  it("两种毛病同时存在时各报一条，不合并", () => {
    const report = auditProbeInventory([helpers, { name: "045_bare.sql", text: "begin; rollback;" }]);
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      "PROBE_WITHOUT_ASSERT",
      "PROBE_WITHOUT_EXPECTATION",
    ]);
  });

  it("bootstrap.sql 不算探针", () => {
    const report = auditProbeInventory([
      { name: "bootstrap.sql", text: "create role authenticated;" },
      helpers,
      goodProbe,
    ]);
    expect(report.issues).toEqual([]);
    expect(report.stats.probeFiles).toBe(1);
  });

  it("问题格式化后带 code 与文件名，便于直接定位", () => {
    const report = auditProbeInventory([helpers, { name: "046_bare.sql", text: "select 1;" }]);
    const text = formatProbeIssues(report.issues);
    expect(text).toContain("[PROBE_WITHOUT_ASSERT] 046_bare.sql");
    expect(text).toContain("[PROBE_WITHOUT_EXPECTATION] 046_bare.sql");
  });
});

describe("summarizeProbeRun", () => {
  it("全过时报告迁移数、探针数、用例数", () => {
    const summary = summarizeProbeRun({ migrations: 37, probeFiles: 4, cases: 48, failures: 0 });
    expect(summary.ok).toBe(true);
    expect(summary.message).toContain("37 个迁移");
    expect(summary.message).toContain("4 个探针 / 48 条用例");
  });

  it("有失败时带分母，不只报分子", () => {
    const summary = summarizeProbeRun({ migrations: 37, probeFiles: 4, cases: 48, failures: 3 });
    expect(summary.ok).toBe(false);
    expect(summary.message).toContain("3/4 个探针不通过");
  });
});

/**
 * 这条是「门禁自己会不会响」在真实仓库上的读数：拿真文件跑一遍盘点。
 * 纯函数单测用的是合成文本，合成文本永远合格——所以还要有一次真读数，
 * 否则「探针都写了断言」这件事仍然只是相信。
 */
describe("仓库真实探针", () => {
  const testsDir = path.join(REPO_ROOT, "supabase", "tests");
  const files = fs
    .readdirSync(testsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, text: fs.readFileSync(path.join(testsDir, name), "utf8") }));

  it("每个探针都同时有 expect 与 verify，且用例总量大于探针数", () => {
    const report = auditProbeInventory(files);
    expect(formatProbeIssues(report.issues)).toBe("");
    expect(report.stats.probeFiles).toBeGreaterThanOrEqual(4);
    expect(report.stats.cases).toBeGreaterThan(report.stats.probeFiles);
  });
});
