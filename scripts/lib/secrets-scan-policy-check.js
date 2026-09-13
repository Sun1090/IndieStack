/**
 * Secrets Scan 扫描强度与泄漏处置策略检查实现（J05）。
 *
 * 规则本体在 src/lib/security/secrets-scan-policy.ts（纯函数，由 vitest 覆盖）；这里负责读取
 * `.github/workflows/secrets-scan.yml`、可选的 `.gitleaks.toml` 与泄漏响应 runbook，并输出带规则码的报告。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditSecretsScanPolicy,
  formatSecretsScanIssues,
  SECRETS_SCAN_CONTRACT,
} from "../../src/lib/security/secrets-scan-policy.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 读取一个仓库相对文件的文本；不存在时返回 undefined（由规则层判定为缺失或可选）。 */
export function readTextFile(relativePath, repoRoot = REPO_ROOT) {
  const absolute = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolute)) return undefined;
  return { path: relativePath, content: fs.readFileSync(absolute, "utf8") };
}

/** 组装策略校验所需的全部输入，导出以便测试用临时目录验证 CLI。 */
export function buildSecretsScanSnapshot(repoRoot = REPO_ROOT) {
  return {
    workflow: readTextFile(SECRETS_SCAN_CONTRACT.path, repoRoot),
    config: readTextFile(SECRETS_SCAN_CONTRACT.configPath, repoRoot),
    runbook: readTextFile(SECRETS_SCAN_CONTRACT.runbookPath, repoRoot),
  };
}

/** 返回进程退出码：0 表示扫描强度、allowlist 与处置流程都与契约一致，1 表示漂移或 IO 错误。 */
export function runSecretsScanPolicyCheck(repoRoot = REPO_ROOT) {
  let snapshot;
  try {
    snapshot = buildSecretsScanSnapshot(repoRoot);
  } catch (error) {
    console.error(`❌ 无法读取 Secrets Scan 策略快照：${error.message}`);
    return 1;
  }

  const report = auditSecretsScanPolicy(snapshot);
  if (report.issues.length > 0) {
    console.error(`❌ Secrets Scan 策略校验失败（${report.issues.length} 项）`);
    console.error(formatSecretsScanIssues(report.issues));
    return 1;
  }
  const { actionMajor, pushBranches, requiredFetchDepth, firstResponseMinutes, rotationHours } =
    SECRETS_SCAN_CONTRACT;
  console.log(
    `✅ Secrets Scan 策略校验通过：gitleaks/gitleaks-action@${actionMajor} / fetch-depth ` +
      `${requiredFetchDepth} / push ${pushBranches.join(",")} / 首次响应 ${firstResponseMinutes} 分钟 / ` +
      `轮换 ${rotationHours} 小时（${report.checks} 条契约断言）`,
  );
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) process.exitCode = runSecretsScanPolicyCheck(process.argv[2] ?? REPO_ROOT);
