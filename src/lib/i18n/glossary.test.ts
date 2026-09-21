import { describe, expect, it } from "vitest";
import {
  GLOSSARY,
  GLOSSARY_DOC_HEADING,
  auditGlossary,
  extractGlossarySection,
  formatGlossaryIssues,
  parseGlossaryDoc,
  termPattern,
  type GlossaryEntry,
} from "./glossary";

const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({
  term: "account",
  approved: "账户",
  avoid: ["账号"],
  reason: "测试用",
  ...over,
});

/** 每个用例都带上这条：否则「指定译法一次都没出现」的僵尸规则会混进其它断言。 */
const BASELINE_KEY = "baseline.account";
const BASELINE = { en: { [BASELINE_KEY]: "Your account" }, zh: { [BASELINE_KEY]: "你的账户" } };

function audit(
  cases: Record<string, string>[],
  options: { glossary?: GlossaryEntry[]; exemptions?: Record<string, string> } = {},
) {
  const en: Record<string, string> = { ...BASELINE.en };
  const zh: Record<string, string> = { ...BASELINE.zh };
  cases.forEach((item, index) => {
    const key = `dashboard.case${index + 1}`;
    en[key] = item.en;
    if (item.zh !== undefined) zh[key] = item.zh;
  });
  return auditGlossary(
    { messages: { en, "zh-CN": zh }, exemptions: options.exemptions },
    options.glossary ?? [entry({})],
  );
}

describe("术语匹配", () => {
  it("按词边界匹配并允许复数，不误伤包含该词的其它单词", () => {
    expect(termPattern("account").test("Delete your account")).toBe(true);
    expect(termPattern("account").test("your accounts here")).toBe(true);
    expect(termPattern("account").test("Accounting is hard")).toBe(false);
    expect(termPattern("sign in").test("Sign in to continue")).toBe(true);
    expect(termPattern("sign in").test("signing in")).toBe(false);
    expect(termPattern("api key").test("Create an API Key")).toBe(true);
  });

  it("术语表本身自洽：术语唯一、有禁止变体、指定译法不与禁止变体重叠", () => {
    const terms = GLOSSARY.map((item) => item.term);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms.length).toBeGreaterThan(10);
    for (const item of GLOSSARY) {
      expect(item.avoid.length, item.term).toBeGreaterThan(0);
      for (const variant of item.avoid) {
        expect(variant, item.term).not.toBe(item.approved);
        expect(item.approved.includes(variant), item.term).toBe(false);
      }
    }
  });
});

describe("术语一致性判定", () => {
  it("中文用了禁止变体且缺少指定译法时报违规", () => {
    const report = audit([{ en: "Delete your account", zh: "删除你的账号" }]);
    const issue = report.issues[0];
    expect(report.issues.map((item) => item.code)).toEqual(["GLOSSARY_TERM_FORBIDDEN"]);
    expect(issue.key).toBe("dashboard.case1");
    expect(issue.file).toBe("messages/zh-CN/dashboard.json");
    expect(issue.message).toContain("应译为「账户」");
  });

  it("指定译法在场时，同一句里另一概念的译法不算违规", () => {
    const glossary = [entry({}), entry({ term: "alert", approved: "提醒", avoid: ["告警"] })];
    const report = auditGlossary(
      {
        messages: {
          en: { ...BASELINE.en, "dashboard.desc": "Manage your account notifications and alerts" },
          "zh-CN": { ...BASELINE.zh, "dashboard.desc": "管理账户的通知和提醒" },
        },
      },
      glossary,
    );
    expect(report.issues).toEqual([]);
  });

  it("中文合理地绕开该词不算错误，只是不计入使用次数", () => {
    const report = audit([{ en: "Your account", zh: "个人资料" }]);
    expect(report.issues).toEqual([]);
    expect(report.matchedTerms).toBe(2);
    expect(report.checkedPairs).toBe(2);
    expect(report.approvedUsage.account).toBe(1);
  });

  it("一侧缺键时跳过比对而不是崩溃", () => {
    const report = audit([{ en: "Your account", zh: undefined as unknown as string }]);
    expect(report.issues).toEqual([]);
    expect(report.matchedTerms).toBe(2);
    expect(report.checkedPairs).toBe(1);
  });

  it("登记理由非空才豁免，且豁免不再命中时失败", () => {
    const violation = [{ en: "Your account", zh: "你的账号" }];
    const registered = audit(violation, { exemptions: { "zh-CN:dashboard.case1:account": "刻意的品牌写法" } });
    expect(registered.issues).toEqual([]);
    expect(registered.exempted).toEqual(["zh-CN:dashboard.case1:account"]);

    // 空理由不生效：既补报违规，也报这条登记本身没有理由
    const emptyReason = audit(violation, { exemptions: { "zh-CN:dashboard.case1:account": "" } });
    expect(emptyReason.issues.map((item) => item.code).sort()).toEqual([
      "GLOSSARY_STALE_EXEMPTION",
      "GLOSSARY_TERM_FORBIDDEN",
    ]);

    const stale = audit([{ en: "Your account", zh: "你的账户" }], {
      exemptions: { "zh-CN:dashboard.case1:account": "已经改好了" },
    });
    expect(stale.issues.map((item) => item.code)).toEqual(["GLOSSARY_STALE_EXEMPTION"]);
  });
});

describe("术语一致性：失败封闭", () => {
  it("一条英文文案都没命中术语时失败", () => {
    const report = auditGlossary(
      { messages: { en: { "common.hello": "Hello there" }, "zh-CN": { "common.hello": "你好" } } },
      [entry({})],
    );
    expect(report.matchedTerms).toBe(0);
    expect(report.issues.map((item) => item.code)).toEqual([
      "GLOSSARY_ENTRY_UNUSED",
      "GLOSSARY_NO_MATCHED_KEYS",
    ]);
  });

  it("术语条目一次都没被用到时失败（僵尸规则）", () => {
    const alive = audit([{ en: "Your team", zh: "你的团队" }], {
      glossary: [entry({}), entry({ term: "team", approved: "团队", avoid: ["小组"] })],
    });
    expect(alive.issues).toEqual([]);

    const unused = audit([{ en: "A webhook fires", zh: "一个 Webhook 触发" }], {
      glossary: [entry({}), entry({ term: "webhook", approved: "回调", avoid: ["钩子"] })],
    });
    expect(unused.issues.map((item) => item.code)).toEqual(["GLOSSARY_ENTRY_UNUSED"]);
    expect(unused.issues[0].key).toBe("webhook");
  });
});

describe("术语表文档双向校验", () => {
  const doc = `${GLOSSARY_DOC_HEADING}

| 英文术语 | 指定译法 | 禁止变体 | 说明 |
|---|---|---|---|
| \`account\` | 账户 | \`账号\` | 全站统一 |

## 别的小节

| 其它表格 | 值 | 再来一列 |
|---|---|---|
| 不是术语行 | 是 | 否 |
`;
  const messages = {
    en: { "dashboard.x": "Your account" },
    "zh-CN": { "dashboard.x": "你的账户" },
  };

  it("只解析本小节，不吞掉同一文档里的其它表格", () => {
    const parsed = parseGlossaryDoc(doc);
    expect(parsed.error).toBeNull();
    expect(parsed.entries).toEqual([{ term: "account", approved: "账户", avoid: ["账号"] }]);
    expect(extractGlossarySection(doc)).not.toContain("不是术语行");
  });

  it("文档与代码逐项相等时通过", () => {
    expect(auditGlossary({ messages, glossaryDoc: doc }, [entry({})]).issues).toEqual([]);
  });

  it("文档写错指定译法时双向各报一条", () => {
    const wrong = doc.replace("| 账户 |", "| 帐号 |");
    expect(
      auditGlossary({ messages, glossaryDoc: wrong }, [entry({})]).issues.map((item) => item.code),
    ).toEqual(["GLOSSARY_DOC_MISMATCH", "GLOSSARY_DOC_MISMATCH"]);
  });

  it("文档多出没登记的术语时失败", () => {
    const extra = doc.replace("| 说明 |", "| 说明 |\n| `team` | 团队 | `小组` | 未登记 |");
    const codes = auditGlossary({ messages, glossaryDoc: extra }, [entry({})]).issues.map((item) => item.code);
    expect(codes).toEqual(["GLOSSARY_DOC_MISMATCH"]);
  });

  it("小节缺失或表格为空时失败，而不是静默通过", () => {
    for (const glossaryDoc of ["", "# 没有术语表\n", `${GLOSSARY_DOC_HEADING}\n\n正文，无表格\n`]) {
      const codes = auditGlossary({ messages, glossaryDoc }, [entry({})]).issues.map((item) => item.code);
      expect(codes, JSON.stringify(glossaryDoc)).toEqual(["GLOSSARY_DOC_MISMATCH"]);
    }
  });

  it("表格里缺列时报解析错误", () => {
    const broken = doc.replace("| `account` | 账户 | `账号` | 全站统一 |", "| `account` |");
    const issue = auditGlossary({ messages, glossaryDoc: broken }, [entry({})]).issues[0];
    expect(issue.code).toBe("GLOSSARY_DOC_MISMATCH");
    expect(issue.message).toContain("术语表表格为空");
  });
});

describe("报告格式化", () => {
  it("每行含规则码、文件与键", () => {
    const lines = formatGlossaryIssues(audit([{ en: "Your account", zh: "账号" }]).issues);
    expect(lines[0]).toContain(
      "[GLOSSARY_TERM_FORBIDDEN] messages/zh-CN/dashboard.json · dashboard.case1",
    );
  });
});
