/**
 * CodeQL 扫描强度与告警处置策略检查实现（J04）。
 *
 * 规则本体在 src/lib/security/codeql-alert-policy.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * `.github/workflows/codeql.yml` 与分诊 runbook，并输出带规则码的报告。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditCodeqlAlertPolicy,
  CODEQL_CONTRACT,
  formatCodeqlIssues,
} from "../../src/lib/security/codeql-alert-policy.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 读取一个仓库相对文件的文本；不存在时返回 undefined（由规则层判定为缺失）。 */
export function readTextFile(relativePath, repoRoot = REPO_ROOT) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) return undefined;
  return { path: relativePath, content: fs.readFileSync(absolute, "utf8") };
}

/** 组装策略校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildCodeqlSnapshot(repoRoot = REPO_ROOT) {
  return {
    workflow: readTextFile(CODEQL_CONTRACT.path, repoRoot),
    triageDoc: readTextFile(CODEQL_CONTRACT.triageDocPath, repoRoot),
  };
}

/** 返回进程退出码：0 表示扫描强度与处置策略都与契约一致，1 表示漂移或 IO 错误。 */
export function runCodeqlPolicyCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildCodeqlSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 CodeQL 策略快照：${error.message}`);
    return 1;
  }

  const report = auditCodeqlAlertPolicy(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ CodeQL 策略校验失败（${report.issues.length} 项）`);
    console.error(formatCodeqlIssues(report.issues));
    return 1;
  }
  const { querySuite, languages, actionMajor, blockingSecuritySeverity, triageSlaDays } =
    CODEQL_CONTRACT;
  console.log(
    `✅ CodeQL 策略校验通过：github/codeql-action@${actionMajor} / ${languages.join(",")} / ` +
      `${querySuite} / 严重度 ≥ ${blockingSecuritySeverity} 阻断 / 分诊 SLA ${triageSlaDays} 个工作日 ` +
      `（${report.checks} 条契约断言）`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runCodeqlPolicyCheck(process.argv[2] ?? REPO_ROOT);
