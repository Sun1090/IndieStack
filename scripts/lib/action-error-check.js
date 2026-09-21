/**
 * Server Action 错误码翻译门禁的 IO 层（D02 / D03）。
 *
 * 规则本体在 `src/lib/i18n/action-errors.ts`（纯函数，由 vitest 覆盖）；
 * 这里负责收集文件、读取消息 JSON、打印问题并返回退出码。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_ERROR_MESSAGE_FILE,
  DEFAULT_ACTION_ERROR_LOCALES,
  auditActionErrorTranslation,
  formatActionErrorIssues,
} from "../../src/lib/i18n/action-errors.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 可能产出错误码的源码根目录（Server Action 与被其复用的 service / schema）。 */
export const PRODUCER_DIRS = ["src/lib"];

/** 会把错误码渲染给用户的源码根目录。 */
export const CONSUMER_DIRS = ["src"];

/** 扫描时必须排除的目录片段（生成物与测试不参与约定）。 */
export const SKIP_PATH_SEGMENTS = ["node_modules", ".next", "database.types.ts"];

/**
 * 允许「逐字相同文案」的错误码及理由。
 *
 * 空表是当前状态：所有错误码都是需要翻译的句子。若将来出现品牌名一类无需翻译的码，
 * 必须在这里登记理由，否则门禁失败；不再需要时也必须删掉。
 */
export const IDENTICAL_VALUE_EXEMPTIONS = {};

/**
 * 允许直接把 `*.error` 当文案渲染的文件及理由。
 *
 * 空表表示「所有调用点都必须经 `ta()`」。本次审计修掉了 4 处实例
 * （contact-form / project-settings-form / project-delete-button / member-role-select），
 * 因此不需要任何豁免；新增豁免必须写清为什么不能翻译。
 */
export const RAW_DISPLAY_EXEMPTIONS = {};

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function walk(repoRoot, relativeDir, predicate, collected) {
  const absolute = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absolute)) return;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    if (entry.isDirectory()) {
      walk(repoRoot, toRepoPath(repoRoot, child), predicate, collected);
      continue;
    }
    const repoPath = toRepoPath(repoRoot, child);
    if (SKIP_PATH_SEGMENTS.some((segment) => repoPath.includes(segment))) continue;
    if (predicate(repoPath)) collected.push({ fileName: repoPath, content: fs.readFileSync(child, "utf8") });
  }
}

const isTestFile = (repoPath) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(repoPath);

/**
 * 收集审计输入，导出以便单测与 CLI 共用。
 *
 * @returns {{ producers: Array<{fileName: string, content: string}>, consumers: Array<{fileName: string, content: string}>, messages: Record<string, string>, locales: string[] }}
 */
export function buildActionErrorSnapshot(repoRoot = REPO_ROOT) {
  const producers = [];
  for (const dir of PRODUCER_DIRS) walk(repoRoot, dir, (p) => p.endsWith(".ts") && !isTestFile(p), producers);
  const consumers = [];
  for (const dir of CONSUMER_DIRS)
    walk(repoRoot, dir, (p) => p.endsWith(".tsx") && !isTestFile(p), consumers);
  producers.sort((a, b) => a.fileName.localeCompare(b.fileName));
  consumers.sort((a, b) => a.fileName.localeCompare(b.fileName));

  const locales = [...DEFAULT_ACTION_ERROR_LOCALES];
  const messages = {};
  for (const locale of locales) {
    const file = path.join(repoRoot, ACTION_ERROR_MESSAGE_FILE(locale));
    messages[locale] = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
  }
  return { producers, consumers, messages, locales };
}

/** 返回退出码：0 表示约定成立，1 表示存在阻断问题或 IO 错误。 */
export function runActionErrorCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildActionErrorSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取错误码翻译审计输入：${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const report = auditActionErrorTranslation({
    ...snapshot,
    identicalValueExemptions: IDENTICAL_VALUE_EXEMPTIONS,
    rawDisplayExemptions: RAW_DISPLAY_EXEMPTIONS,
  });

  if (report.issues.length > 0) {
    for (const line of formatActionErrorIssues(report.issues)) console.error(line);
    console.error(`❌ 错误码翻译审计失败：${report.issues.length} 个问题（${report.codes.length} 个错误码）`);
    return 1;
  }

  console.log(
    `✅ 错误码翻译审计通过：${report.codes.length} 个错误码 × ${snapshot.locales.length} 个 locale，` +
      `${snapshot.consumers.length} 个前端文件无裸渲染`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(runActionErrorCheck());
