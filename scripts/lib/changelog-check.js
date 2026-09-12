/**
 * CHANGELOG.md 结构门禁实现。
 *
 * 规则本体在 src/lib/changelog/parse-changelog.ts（纯函数，由 vitest 覆盖）；
 * 这里只负责读取文件、打印结果并给出退出码，方便单测直接调用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatChangelogIssues,
  validateChangelog,
} from "../../src/lib/changelog/parse-changelog.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");

/** 返回进程退出码：0 表示结构合法，1 表示存在阻断错误或文件不可读。 */
export function runChangelogCheck(file = DEFAULT_CHANGELOG_PATH) {
  let markdown;
  try {
    markdown = fs.readFileSync(file, "utf8");
  } catch (error) {
    console.error(`❌ 无法读取 CHANGELOG：${file}（${error.message}）`);
    return 1;
  }

  const report = validateChangelog(markdown);
  const released = report.entries.filter((entry) => entry.label !== "Unreleased").length;

  if (report.warnings.length > 0) console.warn(formatChangelogIssues("warning", report.warnings));
  if (report.errors.length > 0) {
    console.error(`❌ CHANGELOG 结构校验失败（${report.errors.length} 项）`);
    console.error(formatChangelogIssues("error", report.errors));
    return 1;
  }

  console.log(
    `✅ CHANGELOG 结构校验通过：${released} 个已发布版本，${report.entries.length - released} 个 Unreleased 章节`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runChangelogCheck(process.argv[2]);
}
