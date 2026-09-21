import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPARED_LOCALES,
  UNTRANSLATED_VALUE_ALLOWLIST,
  buildLocaleSnapshot,
  diffKeys,
  runLocalesCheck,
} from "../../../scripts/lib/locales-check.js";
import {
  LOCALE_SCRIPT_REQUIREMENTS,
  auditTranslationValues,
  parseMessageNamespace,
} from "./translation-values";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** 用真实消息文件跑一遍审计，只替换指定 locale/命名空间的内容。 */
function auditWithRealMessages(overrides: Record<string, Record<string, unknown>>) {
  const messages = buildLocaleSnapshot(REPO_ROOT);
  for (const [locale, namespaces] of Object.entries(overrides)) {
    for (const [namespace, content] of Object.entries(namespaces)) {
      messages[locale][namespace] = typeof content === "string" ? content : JSON.stringify(content);
    }
  }
  return auditTranslationValues({ messages, allowlist: UNTRANSLATED_VALUE_ALLOWLIST });
}

function realNamespace(locale: string, namespace: string) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "messages", locale, `${namespace}.json`), "utf8"));
}

/** 从命名空间 → 原文的映射里抽出参与对称性校验的叶子路径。 */
function leafKeys(locale: string, namespaces: Record<string, string>) {
  const keys: string[] = [];
  for (const [namespace, content] of Object.entries(namespaces)) {
    keys.push(
      ...[...parseMessageNamespace(locale, namespace, content).values.keys()].map(
        (key) => `${namespace}.${key}`,
      ),
    );
  }
  return keys.sort();
}

describe("翻译完整性门禁（真实仓库）", () => {
  it("当前仓库通过键对称与值审计", () => {
    expect(runLocalesCheck(REPO_ROOT)).toBe(0);
  });

  it("两侧参与校验的 locale 都已登记文字系统期望，且消息目录非空", () => {
    const messages = buildLocaleSnapshot(REPO_ROOT);
    expect(COMPARED_LOCALES.length).toBeGreaterThanOrEqual(2);
    for (const locale of COMPARED_LOCALES) {
      expect(Object.hasOwn(LOCALE_SCRIPT_REQUIREMENTS, locale)).toBe(true);
      expect(Object.keys(messages[locale]).length).toBeGreaterThan(10);
    }
  });

  it("键对称精确到数组下标：少一篇文章就是少一个键", () => {
    const messages = buildLocaleSnapshot(REPO_ROOT);
    const perLocale: Record<string, string[]> = {};
    for (const locale of COMPARED_LOCALES) perLocale[locale] = leafKeys(locale, messages[locale]);
    // 旧实现把数组当叶子，`blog.posts` 只贡献 1 个键；现在每个下标都参与比对
    expect(perLocale[COMPARED_LOCALES[0]]).toContain("blog.posts.3.slug");
    expect(perLocale[COMPARED_LOCALES[0]]).toContain("terms.sections.1.content");
    expect(diffKeys(perLocale)).toEqual({ missingInOther: [], missingInBase: [] });
    expect(perLocale[COMPARED_LOCALES[0]].length).toBeGreaterThan(1200);
  });

  it("例外清单每条都有理由，且至少覆盖一批品牌与占位符", () => {
    const patterns = Object.keys(UNTRANSLATED_VALUE_ALLOWLIST);
    expect(patterns.length).toBeGreaterThan(20);
    for (const pattern of patterns) {
      expect(UNTRANSLATED_VALUE_ALLOWLIST[pattern].length).toBeGreaterThan(0);
      expect(pattern.startsWith("zh-CN:")).toBe(true);
    }
    const report = auditWithRealMessages({});
    expect(report.issues).toEqual([]);
    expect(report.checkedValues).toBeGreaterThan(2000);
    expect(report.exemptedKeys.length).toBeGreaterThan(50);
  });
});

describe("翻译完整性门禁：反例（复现修复前的真实值）", () => {
  it("把安全分区标题还原成英文 \"Security\" 会被挡住", () => {
    const dashboard = realNamespace("zh-CN", "dashboard");
    dashboard.settings.sections.security.title = "Security";
    const issues = auditWithRealMessages({ "zh-CN": { dashboard } }).issues.filter(
      (issue) => issue.code === "I18N_VALUE_UNTRANSLATED",
    );
    expect(issues.map((issue) => issue.key)).toEqual(["dashboard.settings.sections.security.title"]);
  });

  it("把错误码当文案（deleteProjectNotFound = \"projectNotFound\"）会被挡住", () => {
    const dashboard = realNamespace("zh-CN", "dashboard");
    dashboard.projects.deleteProjectNotFound = "projectNotFound";
    const issues = auditWithRealMessages({ "zh-CN": { dashboard } }).issues.filter(
      (issue) => issue.code === "I18N_VALUE_KEY_LEAK",
    );
    expect(issues.map((issue) => issue.key)).toEqual(["dashboard.projects.deleteProjectNotFound"]);
  });

  it("数组里的英文漏翻译同样会被挡住", () => {
    const home = realNamespace("zh-CN", "home");
    home.statLabels[0] = "Technologies";
    const issues = auditWithRealMessages({ "zh-CN": { home } }).issues.filter(
      (issue) => issue.file === "messages/zh-CN/home.json",
    );
    expect(issues.map((issue) => issue.key)).toEqual(["home.statLabels.0"]);
  });

  it("新增未登记的 locale 会被拒绝，而不是静默跳过", () => {
    const messages = buildLocaleSnapshot(REPO_ROOT);
    const report = auditTranslationValues({
      messages: { ...messages, ko: messages.en },
      allowlist: UNTRANSLATED_VALUE_ALLOWLIST,
    });
    expect(
      report.issues.filter((issue) => issue.code === "I18N_LOCALE_NOT_CLASSIFIED").map((issue) => issue.key),
    ).toEqual(["ko"]);
  });

  it("例外条目在文案补齐后必须删除", () => {
    const dashboard = realNamespace("zh-CN", "dashboard");
    dashboard.settings.sections.twoFactor.codePlaceholder = "六位验证码";
    const issues = auditWithRealMessages({ "zh-CN": { dashboard } }).issues.filter(
      (issue) => issue.code === "I18N_STALE_ALLOWLIST",
    );
    expect(issues.map((issue) => issue.key)).toEqual([
      "zh-CN:dashboard.settings.sections.twoFactor.codePlaceholder",
    ]);
  });

  it("删掉一侧的消息键会被对称性检查挡住", () => {
    const snapshot = buildLocaleSnapshot(REPO_ROOT);
    const common = JSON.parse(snapshot.en.common);
    delete common.cancel;
    const enNamespaces = { ...snapshot.en, common: JSON.stringify(common) };
    // 值审计看不出「少了一个键」——中文侧仍然是好文案，必须由对称性检查负责
    const report = auditTranslationValues({
      messages: { en: enNamespaces, "zh-CN": snapshot["zh-CN"] },
      allowlist: UNTRANSLATED_VALUE_ALLOWLIST,
    });
    expect(report.issues).toEqual([]);
    expect(
      diffKeys({ en: leafKeys("en", enNamespaces), "zh-CN": leafKeys("zh-CN", snapshot["zh-CN"]) })
        .missingInBase,
    ).toEqual(["common.cancel"]);
  });
});

describe("翻译完整性门禁：失败封闭", () => {
  function withMessages(write: (root: string) => void) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "indiestack-locales-"));
    try {
      write(directory);
      return runLocalesCheck(directory, {});
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  const writePair = (root: string, zh: string) => {
    for (const [locale, content] of [
      ["en", '{"common":{"save":"Save"}}'],
      ["zh-CN", zh],
    ] as const) {
      fs.mkdirSync(path.join(root, "messages", locale), { recursive: true });
      fs.writeFileSync(path.join(root, "messages", locale, "common.json"), content);
    }
  };

  it("消息目录不存在时失败", () => {
    expect(withMessages(() => {})).toBe(1);
  });

  it("一个字符串值都没有时失败", () => {
    expect(withMessages((root) => writePair(root, '{"common":{}}'))).toBe(1);
  });

  it("JSON 损坏时失败而不是崩溃", () => {
    expect(withMessages((root) => writePair(root, "{ nope"))).toBe(1);
  });

  it("值未翻译时失败，补上中文后通过", () => {
    expect(withMessages((root) => writePair(root, '{"common":{"save":"Save"}}'))).toBe(1);
    expect(withMessages((root) => writePair(root, '{"common":{"save":"保存"}}'))).toBe(0);
  });
});
