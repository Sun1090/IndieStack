/**
 * `check:docs` 的 IO 侧：读 `package.json` 的脚本清单与两份 scripts.md，交给纯规则模块判定。
 *
 * 路径映射是这个门禁曾经失明的地方：本仓库英文文档在 `docs-site/*.md`，只有中文在
 * `docs-site/zh-CN/*.md`。旧入口去找 `docs-site/en/scripts.md`，读不到就跳过，于是英文那一半
 * 从未被校验过还打印「同步」。这里两份都列进判定集合，读不到由规则模块报 `SCRIPTS_DOC_MISSING`。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditScriptsDocs } from "../../src/lib/docs/scripts-docs.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 与 `docs-site/.vitepress/config` 的 locale 目录结构一致：en 在根，zh-CN 在子目录。 */
const DOC_TARGETS = [
  { locale: "en", file: "docs-site/scripts.md" },
  { locale: "zh-CN", file: "docs-site/zh-CN/scripts.md" },
];

function readDoc(repoRoot, file) {
  const absolute = path.join(repoRoot, file);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : null;
}

function scriptNames(repoRoot) {
  const raw = readDoc(repoRoot, "package.json");
  if (raw === null) throw new Error("package.json 读不到，无法比对脚本清单");
  const parsed = JSON.parse(raw);
  return new Set(Object.keys(parsed.scripts ?? {}));
}

/** 返回进程退出码：0 表示两份文档里记录的每个 pnpm 命令都真实存在。 */
export function runScriptsDocsCheck(repoRoot = REPO_ROOT) {
  let names;
  let docs;
  try {
    names = scriptNames(repoRoot);
    docs = DOC_TARGETS.map((target) => ({
      file: target.file,
      content: readDoc(repoRoot, target.file),
    }));
  } catch (error) {
    console.error(`❌ 无法执行文档命令校验：${error.message}`);
    return 1;
  }

  const issues = auditScriptsDocs(docs, names);
  if (issues.length > 0) {
    console.error(`❌ docs-site 记录的命令与 package.json 不一致（${issues.length} 项）`);
    for (const issue of issues) console.error(`   ${issue.code}: ${issue.message}`);
    return 1;
  }

  const counted = docs.filter((entry) => entry.content !== null).length;
  console.log(
    `✅ docs-site scripts 文档与 package.json 同步（${counted}/${docs.length} 份文档、${names.size} 个脚本）`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runScriptsDocsCheck(process.argv[2] ?? REPO_ROOT);
