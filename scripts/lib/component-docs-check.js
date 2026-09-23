/**
 * 组件参考文档一致性门禁（D05）实现。
 *
 * 规则本体在 src/lib/docs/component-docs.ts（纯函数，由 vitest 覆盖）；这里只负责读取
 * 两份 locales 文档，以及 `src/components/<dir>/*.tsx` 的模块清单。
 *
 * 模块清单刻意只收 `.tsx` 且排除测试：`dashboard-nav-links.ts` 这类同名 helper 不是组件，
 * 要求文档为它开行会得到一份把文档写成文件清单的结果。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditComponentDocs,
  formatComponentDocIssues,
} from "../../src/lib/docs/component-docs.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * 接受校验的文档。`exhaustive: true` 是组件参考本身，必须列全；`CLAUDE.md` 是给 AI 助手读的
 * 仓库摘要，只要求「写到的组件真实、写出的数量正确」。
 */
export const COMPONENT_DOCS = [
  { file: "docs-site/components.md", exhaustive: true },
  { file: "docs-site/zh-CN/components.md", exhaustive: true },
  { file: "CLAUDE.md", exhaustive: false },
  { file: "docs/architecture/09-frontend-components.md", exhaustive: false },
  { file: "agents/09-ui-ux.md", exhaustive: false },
];

function readDoc(repoRoot, relative) {
  try {
    return fs.readFileSync(path.join(repoRoot, relative), "utf8");
  } catch {
    return null;
  }
}

/** 读取审计所需的两半文档与组件模块清单；目录不存在时失败封闭，交给 CLI 报错。 */
export function buildSnapshot(repoRoot = REPO_ROOT) {
  const componentsDir = path.join(repoRoot, "src/components");
  const modules = fs
    .readdirSync(componentsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      fs
        .readdirSync(path.join(componentsDir, entry.name))
        .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
        .map((name) => ({ directory: entry.name, name: name.replace(/\.tsx$/, "") })),
    )
    .sort((left, right) => `${left.directory}/${left.name}`.localeCompare(`${right.directory}/${right.name}`));
  const docs = COMPONENT_DOCS.map((entry) => ({
    file: entry.file,
    exhaustive: entry.exhaustive,
    content: readDoc(repoRoot, entry.file),
  }));
  return { docs, modules };
}

/** 返回进程退出码：0 表示两半文档都与代码一致，1 表示存在阻断问题或 IO 错误。 */
export function runComponentDocsCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取组件清单：${error.message}`);
    return 1;
  }

  const report = auditComponentDocs(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ 组件参考一致性检查失败（${report.issues.length} 项）`);
    console.error(formatComponentDocIssues(report.issues));
    return 1;
  }
  console.log(
    `✅ 组件参考一致性通过：${report.stats.rows} 行 / ${report.stats.enumeratedModules} 个枚举组件 / ` +
      `${report.stats.counts} 处数量声明 × ${report.stats.docs} 份文档` +
      `（${report.stats.skippedModules} 个组件位于不要求枚举的目录）`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runComponentDocsCheck(process.argv[2] ?? REPO_ROOT);
