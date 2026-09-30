/**
 * next-intl 静态 missing-key 门禁实现。
 *
 * 规则本体在 src/lib/i18n/translation-usage.ts（纯函数，由 vitest 覆盖）；这里只负责把
 * 仓库现状读成 snapshot、打印结果并给出退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditTranslationUsage,
  formatTranslationUsageIssues,
} from "../../src/lib/i18n/translation-usage.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(REPO_ROOT, "src");
const LOCALES = ["en", "zh-CN"];

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

function loadMessages(repoRoot, locale) {
  const dir = path.join(repoRoot, "messages", locale);
  return Object.fromEntries(
    fs.readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => [
        path.basename(file, ".json"),
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")),
      ]),
  );
}

/** 仓库现状快照（导出以便单测用临时目录构造反例）。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  return {
    files: collectFiles(path.join(repoRoot, "src")).map((file) => ({
      path: toRepoPath(repoRoot, file),
      content: fs.readFileSync(file, "utf8"),
    })),
    messages: Object.fromEntries(LOCALES.map((locale) => [locale, loadMessages(repoRoot, locale)])),
  };
}

/** 返回进程退出码：0 表示没有 missing key，1 表示有。 */
export function runTranslationUsageCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 i18n 快照：${error.message}`);
    return 1;
  }

  const report = auditTranslationUsage({ ...snapshot, locales: LOCALES });
  if (report.errors.length > 0) {
    console.error(`❌ next-intl missing-key 门禁失败（${report.errors.length} 个问题）:`);
    console.error(formatTranslationUsageIssues(report.errors));
    return 1;
  }
  console.log(
    `✅ next-intl missing-key 门禁通过：扫描 ${report.stats.scannedCalls} 个静态翻译调用` +
      `（${report.stats.boundNamespaces} 个命名空间绑定 / ${report.stats.scannedFiles} 个文件），` +
      `en/zh-CN 均存在`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runTranslationUsageCheck(process.argv[2] ?? REPO_ROOT);
}
