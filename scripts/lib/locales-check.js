/**
 * i18n 翻译完整性门禁的 IO 层（D02 / D03）。
 *
 * 两段检查：
 *   - **键对称**（既有行为）：en 与 zh-CN 的嵌套键集合必须完全一致；
 *   - **值完整**（新增）：值里既没有该 locale 期望的文字、或者值本身是个内部标识符，
 *     都要失败。规则本体在 `src/lib/i18n/translation-values.ts`（纯函数，由 vitest 覆盖）。
 *
 * 键对称挡住「忘了加键」，值完整挡住「加了键但忘了翻译」——后者此前完全无人值守，
 * `settings.sections.security.title` 就长期是英文 `"Security"`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditTranslationValues,
  formatTranslationValueIssues,
  parseMessageNamespace,
} from "../../src/lib/i18n/translation-values.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 参与对称性校验的 locale（新增 locale 时这里与 LOCALE_SCRIPT_REQUIREMENTS 都要登记）。 */
export const COMPARED_LOCALES = ["en", "zh-CN"];

/**
 * 确实不需要翻译的 zh-CN 值：`<locale>:<namespace>.<key>` → 理由。
 *
 * 只有三类：品牌与产品名、邮箱/验证码一类占位符、以及消息里承担标识符职责的**结构字段**
 * （slug、版本号、分类枚举）。路径段里的 `*` 只匹配一个下标或字段名，所以
 * `blog.posts.*.slug` 放行 slug 却仍然审得到同数组的 `title`。
 * 每一条都必须**主动登记**而不是被规则放行；条目一旦不再命中任何值，门禁就会失败并要求删除，
 * 这样例外清单不会随时间只增不减。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const UNTRANSLATED_VALUE_ALLOWLIST = {
  // 邮箱与验证码占位符：翻译反而会让用户以为可以填中文
  "zh-CN:auth.login.emailPlaceholder": "邮箱占位符，格式与语言无关",
  "zh-CN:auth.register.emailPlaceholder": "邮箱占位符，同上",
  "zh-CN:auth.forgotPassword.emailPlaceholder": "邮箱占位符，同上",
  "zh-CN:contact.form.emailPlaceholder": "邮箱占位符，同上",
  "zh-CN:dashboard.team.invite.emailPlaceholder": "邮箱占位符，同上",
  "zh-CN:auth.mfa.recoveryPlaceholder": "恢复码格式示例，必须与生成规则逐字一致",
  "zh-CN:dashboard.settings.sections.twoFactor.codePlaceholder": "6 位数字码格式示例",

  // 提供方 / 平台品牌名
  "zh-CN:auth.login.oauthGithub": "提供方品牌名",
  "zh-CN:auth.login.oauthGoogle": "提供方品牌名",
  "zh-CN:auth.login.oauthApple": "提供方品牌名",
  "zh-CN:auth.register.oauthGithub": "提供方品牌名",
  "zh-CN:auth.register.oauthGoogle": "提供方品牌名",
  "zh-CN:auth.register.oauthApple": "提供方品牌名",
  "zh-CN:common.github": "提供方品牌名",
  "zh-CN:common.twitter": "平台品牌名",
  "zh-CN:contact.info.github": "提供方品牌名",
  "zh-CN:contact.info.twitter": "平台品牌名（含 X 的现名）",

  // 产品与协议名
  "zh-CN:common.appName": "产品名",
  "zh-CN:common.tierFeatures.ssoSaml": "协议缩写，中文语境同样写 SSO / SAML",
  "zh-CN:about.techStack.items.*.name": "技术产品名，与 home.techStackSection 同一份清单",
  "zh-CN:home.techStackSection.items.*": "技术产品名列表，徽章原样展示",
  "zh-CN:features.categories.1.features.0.title": "数据库产品名 PostgreSQL",
  "zh-CN:features.categories.5.features.1.title": "协议缩写 CI/CD",

  // 语言列表按各语言自称展示（en/ko 无汉字；ja/zh 恰好含汉字，故不登记）
  "zh-CN:dashboard.profile.view.languages.en": "语言列表按各语言自称展示",
  "zh-CN:dashboard.profile.view.languages.ko": "语言列表按各语言自称展示",

  // 结构字段：值是指向代码或 URL 的标识符，不是文案
  "zh-CN:blog.posts.*.slug": "文章 slug，路由标识符",
  "zh-CN:blog.posts.*.date": "ISO 日期，渲染前按 locale 展示",
  "zh-CN:changelog.releases.*.version": "版本号",
  "zh-CN:changelog.releases.*.category": "分类枚举，用作 typeLabels 的查找键",
  "zh-CN:changelog.releases.*.changes.*.type": "分类枚举，用作样式与图标查找键",
  "zh-CN:dashboard.integrations.items.*.id": "集成项 id，用作图标与状态查找键",
  "zh-CN:dashboard.integrations.items.*.name": "集成提供方品牌名",
};

function readLocaleDirectory(repoRoot, locale) {
  const dir = path.join(repoRoot, "messages", locale);
  const namespaces = {};
  // 目录缺失不抛栈：值审计的 I18N_NO_MESSAGE_VALUES 会以更准确的消息失败封闭。
  if (!fs.existsSync(dir)) return namespaces;
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    namespaces[path.basename(file, ".json")] = fs.readFileSync(path.join(dir, file), "utf8");
  }
  return namespaces;
}

/**
 * 读取参与校验的消息文件原文，供两段检查共用。
 * @param {string} [repoRoot]
 * @returns {Record<string, Record<string, string>>} locale → (namespace → 文件原文)
 */
export function buildLocaleSnapshot(repoRoot = REPO_ROOT) {
  const messages = {};
  for (const locale of COMPARED_LOCALES) messages[locale] = readLocaleDirectory(repoRoot, locale);
  return messages;
}

/** 比对两组扁平化键，返回两侧的缺口。 */
export function diffKeys(perLocaleKeys) {
  const [base, other] = Object.values(perLocaleKeys);
  const baseSet = new Set(base);
  const otherSet = new Set(other);
  return {
    missingInOther: base.filter((key) => !otherSet.has(key)),
    missingInBase: other.filter((key) => !baseSet.has(key)),
  };
}

/**
 * 返回退出码：0 表示键与值都完整，1 表示存在阻断问题。
 *
 * `allowlist` 默认取本仓库登记的例外清单；扫描别的内容（例如测试里的临时目录）时必须显式传入，
 * 否则「例外不再命中」会把它自己的判定混进来。
 *
 * @param {string} [repoRoot]
 * @param {Record<string, string>} [allowlist]
 */
export function runLocalesCheck(repoRoot = REPO_ROOT, allowlist = UNTRANSLATED_VALUE_ALLOWLIST) {
  const messages = buildLocaleSnapshot(repoRoot);
  const perLocaleKeys = {};
  const parseFailures = [];

  for (const locale of COMPARED_LOCALES) {
    const keys = [];
    for (const [namespace, content] of Object.entries(messages[locale])) {
      const parsed = parseMessageNamespace(locale, namespace, content);
      // 解析失败要报出来，但键集合留空：不让一个坏文件把两侧都伪装成「对称」。
      if (parsed.error) parseFailures.push(`${parsed.fileName}: ${parsed.error}`);
      else keys.push(...[...parsed.values.keys()].map((key) => `${namespace}.${key}`));
    }
    perLocaleKeys[locale] = keys.sort();
  }

  if (parseFailures.length) {
    console.error(`❌ 消息文件解析失败:\n  ${parseFailures.join("\n  ")}`);
    return 1;
  }

  const { missingInOther, missingInBase } = diffKeys(perLocaleKeys);
  let failed = false;
  if (missingInOther.length) {
    console.error(`❌ zh-CN 缺失 ${missingInOther.length} 个 key:\n  ` + missingInOther.join("\n  "));
    failed = true;
  }
  if (missingInBase.length) {
    console.error(`❌ en 缺失 ${missingInBase.length} 个 key:\n  ` + missingInBase.join("\n  "));
    failed = true;
  }
  if (failed) return 1;


  const report = auditTranslationValues({ messages, allowlist });
  if (report.issues.length) {
    for (const line of formatTranslationValueIssues(report.issues)) console.error(line);
    console.error(`❌ 翻译值审计失败：${report.issues.length} 个问题`);
    return 1;
  }

  console.log(
    `✅ 翻译对称性校验通过：${COMPARED_LOCALES.join("/")} 各 ${perLocaleKeys[COMPARED_LOCALES[0]].length} 个 key 完全一致` +
      `（值审计 ${report.checkedValues} 条文案，${report.exemptedKeys.length} 条登记为无需翻译）`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(runLocalesCheck());
