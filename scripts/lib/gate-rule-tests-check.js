/**
 * 门禁规则模块单测覆盖审计实现。
 *
 * 规则本体在 src/lib/release/gate-rule-tests.ts（纯函数，由 vitest 覆盖）；这里只负责把
 * 仓库现状读成 snapshot、打印结果并给出退出码。
 *
 * 「这条门禁引用了哪些规则模块」是**读脚本文本**得到的——这是个启发式，所以规则本体里
 * 对「一条都没检出」失败封闭：提取失效应出声，不能安静地报 0 项通过。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditGateRuleTests, formatGateRuleTestIssues } from "../../src/lib/release/gate-rule-tests.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GATE_PREFIX = "check:";

/** 脚本里出现即视为「引用了 src/lib 规则模块」的两类写法。 */
const SRC_LIB_REF = /src\/lib\/[\w./-]+\.ts/g;
const RELATIVE_TS_REF = /["'`](\.\.\/[\w./-]+\.ts)["'`]/g;

function toRepoPath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function collectFiles(root, predicate, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) collectFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

const isTestFile = (absolutePath) => /\.(test|spec)\.tsx?$/.test(absolutePath);

/** 把 `../ui/state-rules.ts` 这类相对引用还原成 `src/lib/ui/state-rules.ts`。 */
function resolveRelativeModule(fromRepoPath, ref) {
  const fromDir = path.posix.dirname(`scripts/${fromRepoPath.replace(/^scripts\//, "")}`);
  const joined = path.posix.normalize(path.posix.join(fromDir, ref));
  return joined.startsWith("src/") ? joined : null;
}

/**
 * 抽出每个 `check:*` 门禁脚本引用的规则模块。
 *
 * 同一门禁经由 wrapper → `scripts/lib/*-check.js` 两跳引用规则模块，所以两跳都要跟。
 */
export function collectGateRuleRefs(repoRoot = REPO_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const gates = [];
  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    if (!name.startsWith(GATE_PREFIX)) continue;
    const scriptMatch = command.match(/node\s+(\S+)/);
    if (!scriptMatch) continue;
    const scriptRepoPath = scriptMatch[1];
    const scriptAbs = path.join(repoRoot, scriptRepoPath);
    if (!fs.existsSync(scriptAbs)) continue;

    const ruleModules = new Set();
    const visit = (absPath) => {
      let text;
      try {
        text = fs.readFileSync(absPath, "utf8");
      } catch {
        return;
      }
      const repoPath = toRepoPath(repoRoot, absPath);
      for (const match of text.matchAll(SRC_LIB_REF)) ruleModules.add(match[0]);
      for (const match of text.matchAll(RELATIVE_TS_REF)) {
        const resolved = resolveRelativeModule(repoPath, match[1]);
        if (resolved) ruleModules.add(resolved);
      }
    };
    visit(scriptAbs);

    // 第二跳：wrapper 里 spawn 出去的 scripts/lib/*.js
    const wrapperText = fs.readFileSync(scriptAbs, "utf8");
    for (const match of wrapperText.matchAll(/path\.join\(__dirname,\s*"lib",\s*"([\w.-]+)"\)/g)) {
      const second = path.join(repoRoot, "scripts", "lib", match[1]);
      if (fs.existsSync(second)) visit(second);
    }

    gates.push({ name, ruleModules: [...ruleModules] });
  }
  return gates;
}

/** 仓库里全部测试文件的相对路径。 */
export function collectTestFiles(repoRoot = REPO_ROOT) {
  return collectFiles(path.join(repoRoot, "src"), isTestFile).map((f) => toRepoPath(repoRoot, f));
}

/** 返回进程退出码：0 表示每条规则模块都有单测，1 表示存在没兜底的。 */
export function runGateRuleTestsCheck(repoRoot = REPO_ROOT) {
  let gates;
  let testFiles;
  try {
    gates = collectGateRuleRefs(repoRoot);
    testFiles = collectTestFiles(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取门禁接线快照：${error.message}`);
    return 1;
  }

  const report = auditGateRuleTests({ gates, testFiles });
  if (report.errors.length > 0) {
    console.error(`❌ 门禁规则模块单测覆盖审计失败（${report.errors.length} 项）`);
    console.error(formatGateRuleTestIssues(report.errors));
    return 1;
  }
  const { totalGates, gatedGates, inlineGates, ruleModules } = report.stats;
  console.log(
    `✅ 门禁规则模块都有单测：${ruleModules} 个规则模块 / ${gatedGates} 条门禁走规则模块` +
      `（另有 ${inlineGates} 条判定内联在脚本里，强度未被单测兜底；全库 ${testFiles.length} 个测试文件）`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runGateRuleTestsCheck(process.argv[2] ?? REPO_ROOT);
}
