/**
 * 书写方向门禁的 IO 层（D08）。
 *
 * 只负责遍历 `src` 下的应用层 tsx/jsx 并读出原文，判定在
 * `src/lib/styling/direction.ts`（纯函数，由 vitest 覆盖）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditDirection, formatDirectionIssues, isAuditedFile } from "../../src/lib/styling/direction.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 收集受审文件。
 * @param {string} [repoRoot]
 * @returns {{fileName: string, content: string}[]}
 */
export function buildDirectionSnapshot(repoRoot = REPO_ROOT) {
  const files = [];
  const srcRoot = path.join(repoRoot, "src");
  // 目录缺失不抛栈：纯函数的 DIRECTION_NO_FILES 会以更准确的消息失败封闭。
  if (!fs.existsSync(srcRoot)) return files;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|jsx)$/.test(entry.name)) {
        const relative = path.relative(repoRoot, full).replace(/\\/g, "/");
        if (isAuditedFile(relative)) files.push({ fileName: relative, content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(srcRoot);
  return files.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** 返回退出码：0 表示应用层没有物理方向类，1 表示存在违规或扫描失效。 */
export function runDirectionCheck(repoRoot = REPO_ROOT) {
  const files = buildDirectionSnapshot(repoRoot);
  const report = auditDirection({ files });
  if (report.issues.length) {
    for (const line of formatDirectionIssues(report.issues)) console.error(line);
    console.error(`❌ 书写方向检查失败：${report.issues.length} 个问题`);
    return 1;
  }
  console.log(
    `✅ 书写方向检查通过：${report.checkedFiles} 个应用层文件无物理方向类（src/components/ui/** 按设计排除）`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(runDirectionCheck());
