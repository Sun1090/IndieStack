/**
 * 双语调度事实门禁规则测试（D02）。
 * 覆盖：抽取与归一化、两边集合必须相等、缺失配对、空文档与「零配对」失败封闭。
 */
import { describe, it, expect } from "vitest";
import {
  auditBilingualDocs,
  extractSchedulingFacts,
  formatBilingualDocIssues,
  zhCounterpartPath,
  type BilingualDocDocument,
} from "./bilingual-facts";

function pair(en: string, zh: string): BilingualDocDocument[] {
  return [
    { path: "docs-site/email.md", content: en },
    { path: "docs-site/zh-CN/email.md", content: zh },
  ];
}

describe("extractSchedulingFacts", () => {
  it("抽出 cron 表达式与紧跟 UTC 的时刻并归一化", () => {
    const facts = extractSchedulingFacts(
      "调度 `0 9 * * *`，另有 9:05 UTC 与 0 22  *  *  * 两条；每天 10:00 UTC 跑健康检查。",
    );
    expect(facts.cronExpressions).toEqual(["0 22 * * *", "0 9 * * *"]);
    expect(facts.utcTimes).toEqual(["09:05", "10:00"]);
  });

  it("拒绝非法表达式与不存在的时刻", () => {
    const facts = extractSchedulingFacts("`0 25 * * *` 与 25:70 UTC 都不是合法事实");
    expect(facts.cronExpressions).toEqual([]);
    expect(facts.utcTimes).toEqual([]);
  });

  it("没有 UTC 后缀的时间不算调度事实", () => {
    expect(extractSchedulingFacts("页面在 08:30 打开").utcTimes).toEqual([]);
  });
});

describe("zhCounterpartPath", () => {
  it("英文页映射到同名中文页", () => {
    expect(zhCounterpartPath("docs-site/zh-CN/email.md")).toBe("docs-site/zh-CN/zh-CN/email.md");
    expect(zhCounterpartPath("docs-site/sub/web-push.md")).toBe("docs-site/zh-CN/sub/web-push.md");
  });
});

describe("auditBilingualDocs", () => {
  it("两边调度事实相同则通过", () => {
    const report = auditBilingualDocs(pair("每天 `0 9 * * *`（09:00 UTC）", "`0 9 * * *`，09:00 UTC"));
    expect(report.issues).toEqual([]);
    expect(report.pairs).toEqual(["docs-site/email.md"]);
    expect(report.facts).toEqual({ cronExpressions: ["0 9 * * *"], utcTimes: ["09:00"] });
  });

  it("一边只写时刻、另一边写表达式时报 cron 缺失", () => {
    const report = auditBilingualDocs(pair("`0 9 * * *` 每天 09:00 UTC", "每天 09:00 UTC"));
    expect(report.issues.map((issue) => issue.code)).toEqual(["DOC_CRON_MISMATCH"]);
    expect(report.issues[0].detail).toContain("缺少 0 9 * * *");
  });

  it("中文版多出一个时刻时报「多出」", () => {
    const report = auditBilingualDocs(pair("09:00 UTC", "09:00 UTC，另有 22:00 UTC"));
    expect(report.issues.map((issue) => issue.code)).toEqual(["DOC_TIME_MISMATCH"]);
    expect(report.issues[0].detail).toContain("多出 22:00");
  });

  it("cron 与时刻同时漂移时报两条，各自可定位", () => {
    const report = auditBilingualDocs(pair("`0 9 * * *` 09:00 UTC", "`0 5 * * *` 05:00 UTC"));
    expect(report.issues.map((issue) => issue.code)).toEqual(["DOC_CRON_MISMATCH", "DOC_TIME_MISMATCH"]);
  });

  it("没有中文配对时按缺失报告而不是静默跳过", () => {
    const report = auditBilingualDocs([{ path: "docs-site/web-push.md", content: "09:00 UTC" }]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["DOC_PAIR_MISSING", "DOC_NO_PAIRS"]);
  });

  it("空文档按无法核对失败封闭，且这一对不计入已核对数量", () => {
    const report = auditBilingualDocs(pair("09:00 UTC", "   \n"));
    expect(report.issues[0]).toEqual({
      code: "DOC_SOURCE_EMPTY",
      document: "docs-site/zh-CN/email.md",
      detail: "文档内容为空，按「无法核对」处理而不是「没有差异」",
    });
    expect(report.issues.map((issue) => issue.code)).toContain("DOC_NO_PAIRS");
    expect(report.pairs).toEqual([]);
  });

  it("两边都没有调度事实时通过（多数页面不含调度）", () => {
    const report = auditBilingualDocs(pair("# Email\n没有调度信息", "# 邮件\n没有调度信息"));
    expect(report.issues).toEqual([]);
    expect(report.facts).toEqual({ cronExpressions: [], utcTimes: [] });
  });

  it("只给中文页时不会重复核对，并以零配对失败封闭", () => {
    const report = auditBilingualDocs([{ path: "docs-site/zh-CN/email.md", content: "09:00 UTC" }]);
    expect(report.issues.map((issue) => issue.code)).toEqual(["DOC_NO_PAIRS"]);
  });
});

describe("formatBilingualDocIssues", () => {
  it("输出规则码与文档路径", () => {
    const report = auditBilingualDocs(pair("`0 9 * * *`", "`0 5 * * *`"));
    expect(formatBilingualDocIssues(report.issues)).toContain("[DOC_CRON_MISMATCH] docs-site/email.md");
  });
});
