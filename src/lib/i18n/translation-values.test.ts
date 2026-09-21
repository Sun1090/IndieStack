import { describe, expect, it } from "vitest";
import {
  CJK_PATTERN,
  KEY_SHAPED_VALUE,
  LOCALE_SCRIPT_REQUIREMENTS,
  auditTranslationValues,
  formatTranslationValueIssues,
  matchAllowlistEntry,
  parseMessageNamespace,
} from "./translation-values";

/** 构造只含一个 locale / 一个命名空间的审计输入。 */
function input(locale: string, namespace: string, content: unknown) {
  return {
    messages: { [locale]: { [namespace]: typeof content === "string" ? content : JSON.stringify(content) } },
  };
}

function codes(locale: string, namespace: string, content: unknown, allowlist?: Record<string, string>) {
  return auditTranslationValues({ ...input(locale, namespace, content), allowlist }).issues;
}

describe("翻译值审计：文字系统判定", () => {
  it("只把汉字算作中文，谚文与假名单独出现不算", () => {
    expect(CJK_PATTERN.test("安全")).toBe(true);
    expect(CJK_PATTERN.test(" danger")).toBe(false);
    // 谚文 U+AC00–U+D7AF 曾因为字面字符区间的起点写错而落进汉字符围，导致规则静默失效
    expect(CJK_PATTERN.test("한국어")).toBe(false);
    expect(CJK_PATTERN.test("カタカナ")).toBe(false);
    expect(CJK_PATTERN.test("000000")).toBe(false);
  });

  it("覆盖扩展 A、基本区与兼容表意文字三个区段的边界", () => {
    expect(CJK_PATTERN.test("㐀")).toBe(true); // U+3400
    expect(CJK_PATTERN.test("䶿")).toBe(true); // U+4DBF
    expect(CJK_PATTERN.test("一")).toBe(true); // U+4E00
    expect(CJK_PATTERN.test("鿿")).toBe(true); // U+9FFF
    expect(CJK_PATTERN.test("豈")).toBe(true); // U+F900
    expect(CJK_PATTERN.test("、")).toBe(false); // U+3001 标点不是汉字
  });

  it("内部标识符形状只匹配小写开头的驼峰单词", () => {
    expect(KEY_SHAPED_VALUE.test("projectNotFound")).toBe(true);
    expect(KEY_SHAPED_VALUE.test("PostgreSQL")).toBe(false);
    expect(KEY_SHAPED_VALUE.test("not a key")).toBe(false);
    expect(KEY_SHAPED_VALUE.test("2fa")).toBe(false);
    expect(KEY_SHAPED_VALUE.test(" snake ")).toBe(false);
  });

  it("源语言 locale 不要求任何文字", () => {
    expect(LOCALE_SCRIPT_REQUIREMENTS.en).toBeNull();
    expect(codes("en", "common", { and: "and", days: "days" })).toEqual([]);
  });
});

describe("翻译值审计：规则", () => {
  it("zh-CN 值里没有汉字时报漏翻译", () => {
    const issues = codes("zh-CN", "dashboard", { sections: { security: { title: "Security" } } });
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("I18N_VALUE_UNTRANSLATED");
    expect(issues[0].key).toBe("dashboard.sections.security.title");
    expect(issues[0].file).toBe("messages/zh-CN/dashboard.json");
  });

  it("值是裸驼峰时按内部标识符上报，而不是笼统的漏翻译", () => {
    const issues = codes("zh-CN", "dashboard", { deleteProject: { error: "projectNotFound" } });
    expect(issues.map((entry) => entry.code)).toEqual(["I18N_VALUE_KEY_LEAK"]);
  });

  it("空字符串同样视为未翻译", () => {
    expect(codes("zh-CN", "common", { cancel: "" })[0].code).toBe("I18N_VALUE_UNTRANSLATED");
  });

  it("登记理由非空才放行，并记入 exemptedKeys", () => {
    const content = { appName: "IndieStack" };
    const report = auditTranslationValues({
      ...input("zh-CN", "common", content),
      allowlist: { "zh-CN:common.appName": "产品名" },
    });
    expect(report.issues).toEqual([]);
    expect(report.exemptedKeys).toEqual(["zh-CN:common.appName"]);

    // 空理由不算登记：既补报未翻译，也报这条登记本身没有理由
    const emptyReason = codes("zh-CN", "common", content, { "zh-CN:common.appName": "" });
    expect(emptyReason.map((entry) => [entry.code, entry.key]).sort()).toEqual([
      ["I18N_STALE_ALLOWLIST", "zh-CN:common.appName"],
      ["I18N_VALUE_UNTRANSLATED", "common.appName"],
    ]);
  });

  it("通配登记精确到字段名，不放行同一数组里的兄弟字段", () => {
    const issues = codes(
      "zh-CN",
      "blog",
      { posts: [{ slug: "a-b", title: "Hello" }, { slug: "c-d", title: "World" }] },
      { "zh-CN:blog.posts.*.slug": "文章 slug" },
    );
    expect(issues.map((entry) => entry.key)).toEqual([
      "blog.posts.0.title",
      "blog.posts.1.title",
    ]);
  });

  it("`*` 只匹配单个路径段", () => {
    expect(matchAllowlistEntry({ "zh-CN:a.*.c": "r" }, "zh-CN:a.b.c")?.pattern).toBe("zh-CN:a.*.c");
    expect(matchAllowlistEntry({ "zh-CN:a.*.c": "r" }, "zh-CN:a.b.d.c")).toBeUndefined();
    expect(matchAllowlistEntry({ "zh-CN:a.*.c": "r" }, "zh-CN:a.c")).toBeUndefined();
  });

  it("登记项不再命中任何值时失败，例外清单不能只增不减", () => {
    const issues = codes("zh-CN", "common", { ok: "正常" }, { "zh-CN:common.gone": "已经翻好了" });
    expect(issues.map((entry) => entry.code)).toEqual(["I18N_STALE_ALLOWLIST"]);
    expect(issues[0].key).toBe("zh-CN:common.gone");
    expect(issues[0].file).toBe("messages/zh-CN");
  });
});

describe("翻译值审计：失败封闭", () => {
  it("一个字符串值都没抽到时报 I18N_NO_MESSAGE_VALUES", () => {
    const report = auditTranslationValues(input("en", "common", {}));
    expect(report.checkedValues).toBe(0);
    expect(report.issues.map((entry) => entry.code)).toEqual(["I18N_NO_MESSAGE_VALUES"]);
  });

  it("JSON 解析失败时报出文件名而不是静默跳过", () => {
    const issues = codes("zh-CN", "dashboard", "{ broken");
    expect(issues.map((entry) => entry.code)).toEqual([
      "I18N_NO_MESSAGE_VALUES",
      "I18N_NO_MESSAGE_VALUES",
    ]);
    expect(issues[0].file).toBe("messages/zh-CN/dashboard.json");
  });

  it("未登记文字系统期望的 locale 会被显式拒绝", () => {
    const issues = codes("ko", "common", { appName: "IndieStack" });
    expect(issues.map((entry) => entry.code)).toEqual(["I18N_LOCALE_NOT_CLASSIFIED"]);
  });
});

describe("消息解析", () => {
  it("数组按下标展开，嵌套对象里的字符串也计入", () => {
    const parsed = parseMessageNamespace("zh-CN", "terms", JSON.stringify({
      sections: [{ title: "条款", content: "正文" }],
      labels: ["一", "二"],
      ignored: 3,
    }));
    expect(parsed.error).toBeNull();
    expect([...parsed.values.keys()]).toEqual([
      "sections.0.title",
      "sections.0.content",
      "labels.0",
      "labels.1",
    ]);
    expect(parsed.values.get("labels.1")).toBe("二");
  });

  it("解析失败时返回错误消息与文件名", () => {
    const parsed = parseMessageNamespace("en", "common", "{ nope");
    expect(parsed.values.size).toBe(0);
    expect(parsed.fileName).toBe("messages/en/common.json");
    expect(typeof parsed.error).toBe("string");
  });
});

describe("报告格式化", () => {
  it("每行含规则码、文件与键", () => {
    const lines = formatTranslationValueIssues(codes("zh-CN", "common", { title: "Security" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[I18N_VALUE_UNTRANSLATED]");
    expect(lines[0]).toContain("messages/zh-CN/common.json · common.title");
  });
});
