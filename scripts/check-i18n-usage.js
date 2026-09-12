#!/usr/bin/env node
/**
 * next-intl 静态 missing-key 门禁。
 *
 * 解析 src 中由 useTranslations/getTranslations 创建的命名空间函数，
 * 对所有字面量 t("...")/t.rich/raw/has 调用检查 en 与 zh-CN 是否存在。
 * 动态 key（例如 t(`roles.${role}`)）无法在静态阶段可靠展开，交由 t.has
 * 或运行时回退处理；它们会被明确跳过，而不是伪造为已验证。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const LOCALES = ["en", "zh-CN"];

function loadMessages(locale) {
  const dir = path.join(ROOT, "messages", locale);
  return Object.fromEntries(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => [
        path.basename(file, ".json"),
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")),
      ]),
  );
}

function hasPath(messages, key) {
  return key.split(".").reduce((value, part) => {
    if (value === null || typeof value !== "object" || !(part in value)) return undefined;
    return value[part];
  }, messages) !== undefined;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) files.push(full);
  }
  return files;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

const messages = Object.fromEntries(LOCALES.map((locale) => [locale, loadMessages(locale)]));
const issues = [];
const scanned = new Set();

function checkTranslationCall(file, source, namespace, match) {
  const key = `${namespace}.${match[2]}`;
  const location = `${path.relative(ROOT, file)}:${lineOf(source, match.index)}`;
  scanned.add(`${location}:${key}`);
  for (const locale of LOCALES) {
    if (!hasPath(messages[locale], key)) {
      issues.push(`${location} 缺少 ${locale} 翻译 key: ${key}`);
    }
  }
}

for (const file of walk(SRC)) {
  const source = fs.readFileSync(file, "utf8");
  // Supports the normal forms used by this project, including await getTranslations.
  const namespaces = new Map();
  const namespaceRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(namespaceRe)) namespaces.set(match[1], match[2]);

  for (const [alias, namespace] of namespaces) {
    const callRe = new RegExp(`\\b${alias}\\s*(?:\\.\\s*(?:rich|raw|has))?\\s*\\(\\s*(["'])([^"']+)\\1`, "g");
    for (const match of source.matchAll(callRe)) {
      checkTranslationCall(file, source, namespace, match);
    }
  }
}

if (issues.length) {
  console.error(`❌ next-intl missing-key 门禁失败（${issues.length} 个问题）:`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}
console.log(`✅ next-intl missing-key 门禁通过：扫描 ${scanned.size} 个静态翻译调用，en/zh-CN 均存在`);
