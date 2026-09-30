/**
 * CHANGELOG 与 git tag 对账的实现。
 *
 * 规则本体在 src/lib/release/changelog-tag-reconciliation.ts（纯函数，由 vitest 覆盖）；
 * 这里只负责读 CHANGELOG、跑 `git tag`、打印结果并给出退出码。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MISSING_TAG_LEDGER,
  auditChangelogTags,
  formatChangelogTagIssues,
  formatChangelogTagSummary,
} from "../../src/lib/release/changelog-tag-reconciliation.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TAG_PREFIX = "v";

/** `## [0.11.0] — 2026-09-22` / `## [0.11.0] - 2026-09-22`；`[Unreleased]` 不算已发布。 */
const VERSION_HEADING_RE = /^##\s+\[(\d+\.\d+\.\d+)\]\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;

/** 标题与第一个版本标题之间的说明文字（`# Changelog` 之后、`## ` 之前）。 */
export function parseIntro(changelog) {
  const body = changelog.slice(changelog.indexOf("\n") + 1);
  const end = body.search(/^## /m);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

/** 解析 CHANGELOG 的已发布版本与各自条目数（读到下一个 `## ` 为止）。 */
export function parseReleasedVersions(changelog) {
  const lines = changelog.split("\n");
  const versions = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(VERSION_HEADING_RE);
    if (!match) continue;
    let entries = 0;
    for (let j = i + 1; j < lines.length && !lines[j].startsWith("## "); j += 1) {
      if (/^- /.test(lines[j])) entries += 1;
    }
    versions.push({ version: match[1], date: match[2], entries });
  }
  return versions;
}

/** 仓库里实际存在的 tag。取不到就返回空数组——由规则那一侧失败封闭。 */
export function readTags(repoRoot = REPO_ROOT) {
  try {
    const out = execFileSync("git", ["tag", "--list"], { cwd: repoRoot, encoding: "utf8" });
    return out.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 返回进程退出码：0 表示每个分叉都已显式登记，1 表示存在未登记的分叉。 */
export function runChangelogTagCheck(repoRoot = REPO_ROOT) {
  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  let versions;
  let intro;
  try {
    const changelog = fs.readFileSync(changelogPath, "utf8");
    versions = parseReleasedVersions(changelog);
    intro = parseIntro(changelog);
  } catch (error) {
    console.error(`❌ 无法读取 CHANGELOG：${error.message}`);
    return 1;
  }

  const tags = readTags(repoRoot);
  const report = auditChangelogTags({ versions, tags, ledger: MISSING_TAG_LEDGER, intro });

  if (report.errors.length > 0) {
    console.error(`❌ CHANGELOG 与 git tag 不一致（${report.errors.length} 项）:`);
    console.error(formatChangelogTagIssues(report.errors));
    console.error(
      `  登记缺 tag 的版本：在 src/lib/release/changelog-tag-reconciliation.ts 的 ` +
        `MISSING_TAG_LEDGER 里补一条并写明理由；证据已闭合的则删掉对应登记。`,
    );
    return 1;
  }

  console.log(formatChangelogTagSummary(report));
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runChangelogTagCheck(process.argv[2] ?? REPO_ROOT);
}
