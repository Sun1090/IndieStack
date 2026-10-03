/**
 * 变异核对的 IO 层：改源码 → 跑那个模块自己的套件 → **无条件复原** → 读结论。
 *
 * 三条纪律，各对应一种真实踩过的坑：
 *   1. **复原必须是 finally**。手工做这件事时一旦中途失败，仓库就带着一处「永远判合格」
 *      留在树上——而它会绿。留下的 `.bak` 命名让复原可核对。
 *   2. **读不出结论不等于通过**。判定在纯函数 `summarizeFalsification` 里，
 *      本文件只负责把 vitest 的输出整段交给它，不在这里做正则。
 *   3. **不动别人的工作树**：先确认工作树是干净的。脏树上做这件事，
 *      `git checkout --` 会把别人的未提交改动一起丢掉。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RULE_FALSIFICATION_TARGETS,
  formatFalsificationOutcome,
  neuterFunction,
  summarizeFalsification,
} from "../../src/lib/testing/rule-falsification.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 工作树是否干净（只查已跟踪文件的改动与暂存区）。 */
export function workingTreeIsClean(root) {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (result.error) throw result.error;
  return result.stdout.trim() === "";
}

/** 跑 vitest 的一个文件，返回整段输出（成功与失败都要——失败的输出才是结论）。 */
export function runSuite(root, testFile) {
  const result = spawnSync(
    "npx",
    ["vitest", "run", testFile, "--project", "node"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

/**
 * 核对一个目标：中性化 → 跑套件 → 复原。
 *
 * 复原失败会抛错而**不是**被吞掉：一份「结论是真的但树是脏的」报告比没有报告更贵，
 * 而吞掉异常正是让树脏掉的方式。
 */
export function falsifyTarget(root, target, runSuiteFn = runSuite) {
  const file = path.join(root, target.file);
  const original = fs.readFileSync(file, "utf8");
  const mutation = neuterFunction(original, target.function, target.neuteredReturn);
  if (!mutation.changed) {
    return {
      ...summarizeFalsification(target, ""),
      verdict: "unreadable",
      failedTests: null,
      passedTests: null,
      mutationApplied: false,
    };
  }

  fs.writeFileSync(file, mutation.source);
  try {
    return {
      ...summarizeFalsification(target, runSuiteFn(root, target.testFile)),
      mutationApplied: true,
    };
  } finally {
    fs.writeFileSync(file, original);
    if (fs.readFileSync(file, "utf8") !== original) {
      throw new Error(`复原失败：${target.file} 仍是变异后的内容`);
    }
  }
}

/** 跑完整张表，返回进程退出码：全部「会红」为 0，出现「存活」或「读不出」为 1。 */
export function runFalsification(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const targets = options.targets ?? RULE_FALSIFICATION_TARGETS;
  if (!workingTreeIsClean(root)) {
    console.error("❌ 工作树不干净：变异核对会在脏树上改源码，而复原会连带丢掉未提交的改动。先提交或 stash。");
    return 1;
  }

  const outcomes = targets.map((target) => falsifyTarget(root, target));
  for (const outcome of outcomes) {
    const applied = outcome.mutationApplied ? "" : "（变异没打上——判定函数不存在或不是导出）";
    console.log(formatFalsificationOutcome(outcome) + applied);
  }

  const bites = outcomes.filter((outcome) => outcome.verdict === "bites").length;
  const survivors = outcomes.filter((outcome) => outcome.verdict === "survived");
  const unreadable = outcomes.filter(
    (outcome) => outcome.verdict === "unreadable" || outcome.mutationApplied === false,
  );

  console.log(
    `—— ${bites}/${outcomes.length} 条判定被证明「测试真的会红」` +
      (survivors.length > 0 ? `；❌ 存活 ${survivors.length} 条` : "") +
      (unreadable.length > 0 ? `；⚠️ 读不出/没打上 ${unreadable.length} 条` : ""),
  );
  return survivors.length === 0 && unreadable.length === 0 ? 0 : 1;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runFalsification();
}