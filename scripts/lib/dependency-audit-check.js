/**
 * 依赖审计门禁的 IO 层：取 `pnpm audit --json`、跑判定、打印。
 *
 * **为什么要有这个入口**：CI 的 security-config job 里原本有一步裸的
 * `pnpm audit --audit-level high`。裸命令不看例外台账，所以「上游没有补丁」这一种
 * 真实且不可修的情况会让那一步**永远红**，而红了之后没人能做什么——那不是一条严格的门禁，
 * 是一条不可执行的门禁。改成走同一份判定之后，CI 里这一步仍然是显式的、看得见的
 * 「Dependency audit」，并且与 `pnpm check:security` 里那段**判的是同一件事**。
 *
 * 判定只有一份实现（`src/lib/security/dependency-audit.ts`），所以不存在
 * 「本地过了 CI 没过」这一类偏差；这里只负责取报告与打印。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatSecurityIssues } from "../../src/lib/security/security-config.ts";
import { inspectDependencyAudit } from "../../src/lib/security/dependency-audit.ts";
import { runDependencyAudit } from "./security-config-check.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 跑一次审计判定并返回进程退出码（0 通过 / 1 失败）。
 *
 * @param options.root 仓库根目录。
 * @param options.today `YYYY-MM-DD`，用于例外台账的复核期限；缺省用今天。
 * @param options.exceptions 例外台账；缺省用仓库里那一份（`DEPENDENCY_AUDIT_EXCEPTIONS`）。
 * @param options.runAudit 取报告的动作，测试可注入。
 */
export function runDependencyAuditCheck(options = {}) {
  const root = options.root ?? REPO_ROOT;
  const audit = options.runAudit ?? (() => runDependencyAudit(root));

  let report;
  try {
    report = audit();
  } catch (error) {
    // 读不到审计结果不等于没有漏洞：失败封闭，且说清是「取不到」而不是「有漏洞」。
    console.error("❌ 依赖审计门禁失败 (1):");
    console.error(
      formatSecurityIssues([
        `pnpm audit: command failed or returned invalid JSON (${errorMessage(error)})`,
      ]),
    );
    return 1;
  }

  const result = inspectDependencyAudit(report, {
    today: options.today,
    exceptions: options.exceptions,
  });
  if (Array.isArray(result)) {
    console.error(`❌ 依赖审计门禁失败 (${result.length}):`);
    console.error(formatSecurityIssues(result));
    return 1;
  }

  const excepted =
    result.excepted.length > 0
      ? `；${result.excepted.length} 条已登记例外（${result.excepted.join(", ")}）`
      : "";
  console.log(`✅ 依赖审计通过：${result.critical} critical / ${result.high} high${excepted}`);
  return 0;
}

const invokedAsScript = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedAsScript) {
  process.exitCode = runDependencyAuditCheck();
}