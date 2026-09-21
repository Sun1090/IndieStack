/**
 * 术语一致性门禁的 IO 层（D01）。
 *
 * 只做读文件与打印：`messages/<locale>/*.json` 扁平化成 `namespace.path` → 文案，
 * 加上术语表所在的文档小节，交给 `src/lib/i18n/glossary.ts` 判定。
 * 规则本体是纯函数，由 vitest 覆盖（含真实仓库与反例）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLOSSARY,
  GLOSSARY_DOC_FILE,
  auditGlossary,
  formatGlossaryIssues,
} from "../../src/lib/i18n/glossary.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 参与术语比对的两个 locale：英文是源，中文是被审侧。 */
export const GLOSSARY_LOCALES = ["en", "zh-CN"];

/**
 * 允许某个键不遵循术语表：`zh-CN:<key>:<term>` → 理由。
 *
 * 当前为空——表里的每一项都在真实文案上核过。新增条目必须写理由，
 * 且条目一旦不再命中就会被门禁要求删除，例外清单不能只增不减。
 * @type {Readonly<Record<string, string>>}
 */
export const GLOSSARY_EXEMPTIONS = {};

function flatten(prefix, node, into) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") into.set(full, value);
    else if (value && typeof value === "object" && !Array.isArray(value)) flatten(full, value, into);
    // 数组元素是段落/列表正文（`terms.sections[].content` 等），不做术语比对：
    // 长文里一个术语可能出现多次、也可能被合理改写，逐条判定制裁不了什么，只会制造噪声。
  }
}

/**
 * 读取扁平化文案与术语表文档。
 * @param {string} [repoRoot]
 * @returns {{messages: Record<string, Record<string, string>>, glossaryDoc: string}}
 */
export function buildGlossarySnapshot(repoRoot = REPO_ROOT) {
  const messages = {};
  for (const locale of GLOSSARY_LOCALES) {
    const flat = new Map();
    const dir = path.join(repoRoot, "messages", locale);
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
      const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (content && typeof content === "object" && !Array.isArray(content)) {
        flatten(path.basename(file, ".json"), content, flat);
      }
    }
    messages[locale] = Object.fromEntries([...flat.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }
  return {
    messages,
    // 文档缺失不抛栈：解析器会报「术语表为空」，同样失败封闭但信息更准确。
    glossaryDoc: fs.existsSync(path.join(repoRoot, GLOSSARY_DOC_FILE))
      ? fs.readFileSync(path.join(repoRoot, GLOSSARY_DOC_FILE), "utf8")
      : "",
  };
}

/**
 * 返回退出码：0 表示术语一致，1 表示存在阻断问题。
 *
 * `glossary` 默认取本仓库的术语表；扫描别的内容（例如测试里的临时目录）时必须显式传入，
 * 否则「僵尸条目」与「文档不一致」会把它自己的判定混进来。
 *
 * @param {string} [repoRoot]
 * @param {readonly object[]} [glossary]
 */
export function runGlossaryCheck(repoRoot = REPO_ROOT, glossary = GLOSSARY) {
  const snapshot = buildGlossarySnapshot(repoRoot);
  const report = auditGlossary({ ...snapshot, exemptions: GLOSSARY_EXEMPTIONS }, glossary);
  if (report.issues.length) {
    for (const line of formatGlossaryIssues(report.issues)) console.error(line);
    console.error(`❌ 术语一致性检查失败：${report.issues.length} 个问题`);
    return 1;
  }
  const terms = Object.keys(report.approvedUsage).length;
  console.log(
    `✅ 术语一致性检查通过：${terms} 个术语，命中 ${report.matchedTerms} 次 (键, 术语)、` +
      `可比对 ${report.checkedPairs} 次，${Object.values(report.approvedUsage).reduce((a, b) => a + b, 0)} 次使用指定译法`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) process.exit(runGlossaryCheck());
