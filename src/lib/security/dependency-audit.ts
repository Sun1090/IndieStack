/**
 * 依赖审计判定：把「高危/严重漏洞必须为 0」与「上游根本没发补丁」这两件事分开。
 *
 * 背景是一次真实的红（2026-10-03）：`pnpm check:all` 在 `check:security` 上报
 * `0 critical, 1 high vulnerabilities`，来路是 `braces` 的 GHSA-vfj7-8cjw-p6xm
 * （CVE-2026-93687，递归爆栈 DoS）。量完之后结论是**这个红在本仓库里无法用升级修掉**：
 *
 *   - 路径是 `.>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces`，
 *     即**只在开发期可达**（`eslint-config-next` 是 devDependencies），不进任何生产产物；
 *   - 公告的 patched range 是 `>=3.0.4`，而 npm 上 `braces` 的**最新发布版就是 3.0.3**
 *     （GitHub Advisory Database 那一条的 Patched versions 一栏写的是 None）——
 *     也就是说「有个已发布版本能修」这句话本身就是假的；
 *   - 往上游看也堵不住：`fast-glob` 最新 3.3.3 仍然依赖 `micromatch@^4.0.8`，
 *     而 `micromatch` 最新 4.0.8 仍然依赖 `braces@^3.0.3`。
 *
 * 也就是说这不是「有人忘了升依赖」，而是**在没有补丁可升的时候，一个正确的门禁会永远红**。
 * 本仓库对这种局面的既有答案不是放宽判据，而是**把处置显式登记成临时的，并让它有到期日**：
 * C08 的错误通道台账、C12 的限流两态台账、以及 #193 那条「内联门禁从计数升级为硬失败」
 * 都是同一条纪律——**一个曾经有意义的数字/豁免，必须在条件变化时自己变红**。
 *
 * 因此这里给出的是一个**例外台账**，而它靠四条会红的规则兑现「这是临时的」：
 *
 *   1. **未登记即失败**：任何 high/critical 公告不在台账里就红，并点名 id、模块与依赖路径。
 *      台账**不是白名单**，它是「已知且暂时无法修复」的登记簿。
 *   2. **例外必须自带理由**：可达性说明与理由为空、日期不是 `YYYY-MM-DD`、
 *      `reviewBy` 早于 `reviewedOn` —— 台账自己写不完整就在门禁上红。
 *   3. **条件变化即失败**（反向断言，与 `KNOWN_GAPS` 那条同形）：
 *      - 台账里的公告**不再出现在报告里**（上游发补丁了）→ `EXCEPTION_STALE`，红；
 *      - 台账声称「仅开发期可达」而报告说它**已经出现在生产依赖上** → 红；
 *      - 台账记的模块名与报告说的不是一个 → 红。
 *   4. **复核到期即失败**：`reviewBy < 今天` → 红，提示「重新确认有没有补丁，然后更新日期或删条目」。
 *
 * 第 3 条里的 STALE 是这套机制里最要紧的一条：它保证「例外」不会在修复落地后变成一句
 * 没人再看的话（文档腐化是静默的，而这条不是）。
 *
 * **失败封闭仍然是默认**：报告读不懂、计数字段缺失、blocking 计数大于 0 却给不出公告明细，
 * 一律红。「读不到审计结果不等于没有漏洞」这条从 `security-config.ts` 原样继承。
 *
 * 纯函数（不读文件、不联网），由 Vitest 覆盖，CLI 经 Node 原生 type stripping 消费。
 */

/** 会阻断发布的两个严重级别；其余级别不进本判定。 */
export const BLOCKING_SEVERITIES: ReadonlySet<string> = new Set(["high", "critical"]);

export interface AuditException {
  /** GitHub Advisory ID（`GHSA-…`）。台账的主键就是它——认不出 id 的公告无法登记。 */
  advisoryId: string;
  /** 受影响包名，用来对账报告里的 `module_name`。 */
  module: string;
  /** 严重级别，用来对账报告里的 `severity`。 */
  severity: "high" | "critical";
  /** 为什么生产面够不到：写依赖路径与可达性结论，而不是「应该没事」。 */
  reachability: string;
  /** 为什么现在修不了：上游没发补丁的具体事实（查过什么、什么时候查的）。 */
  justification: string;
  /** 人工核对过的日期 `YYYY-MM-DD`。 */
  reviewedOn: string;
  /** 复核期限 `YYYY-MM-DD`；过了这天门禁就红，逼人重新看一眼有没有补丁。 */
  reviewBy: string;
}

export interface DependencyAuditVerdict {
  /** 报告里的 high 计数（原样带回，便于调用方自报读数）。 */
  high: number;
  /** 报告里的 critical 计数。 */
  critical: number;
  /** 本次被台账吸收的公告 id，已排序。 */
  excepted: readonly string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ADVISORY_ID = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;

export const EXCEPTION_MODULE_PATH = "src/lib/security/dependency-audit.ts";

/**
 * 已登记的「暂无补丁」例外。
 *
 * **加一条之前先读这段**：这里不是漏洞白名单，而是「我知道它红、我查过它为什么红、
 * 而且我答应在某天之前重新查一遍」的登记簿。能修就修，修不了才写在这里，并接受第 4 条
 * 规则在 `reviewBy` 那天把仓库变红。
 */
export const DEPENDENCY_AUDIT_EXCEPTIONS: readonly AuditException[] = [
  {
    advisoryId: "GHSA-vfj7-8cjw-p6xm",
    module: "braces",
    severity: "high",
    reachability:
      "仅开发期可达：eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces，" +
      "eslint-config-next 是 devDependencies，不进任何运行时依赖图，也不进产物。",
    justification:
      "上游未发布任何修复版本：公告写 patched >=3.0.4，而 npm 上 braces 的最新发布版仍是 3.0.3" +
      "（2026-10-03 用 `npm view braces versions` 核过，GitHub Advisory Database 的 " +
      "Patched versions 一栏为 None）。往上游看也堵不住：fast-glob 3.3.3 仍依赖 micromatch ^4.0.8，" +
      "micromatch 4.0.8 仍依赖 braces ^3.0.3。触发面是 lint 时读 glob 模式，不接受网络输入。",
    reviewedOn: "2026-10-03",
    reviewBy: "2026-11-02",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 报告读不懂时，把「到底拿到了什么」写进结论。
 *
 * `pnpm audit --json` 在注册表请求失败时退出码为 1，并打印
 * `{"error":{"code":"pnpm","message":"fetch failed"}}`——它同样是合法 JSON，只是没有
 * `metadata`。笼统地报「report is missing metadata」会让人去查仓库配置，而真正该做的是重跑。
 * 两种情况都仍然失败封闭：读不到审计结果不等于没有漏洞。
 */
export function describeUnreadableReport(report: Record<string, unknown>): string {
  const error = report.error;
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "unknown";
    const message = typeof error.message === "string" ? error.message : "(empty)";
    return `pnpm audit: advisory request failed (code=${code}, message=${message})`;
  }
  const keys = Object.keys(report).sort().join(", ") || "(none)";
  return `pnpm audit: report is missing metadata (top-level keys: ${keys})`;
}

interface Counts {
  high: number;
  critical: number;
}

function readCounts(report: Record<string, unknown>): Counts | string[] {
  const metadata = report.metadata;
  if (!isRecord(metadata)) return [describeUnreadableReport(report)];
  const vulnerabilities = metadata.vulnerabilities;
  if (!isRecord(vulnerabilities)) return ["pnpm audit: report is missing vulnerability counts"];

  const high = vulnerabilities.high;
  const critical = vulnerabilities.critical;
  if (
    typeof high !== "number" ||
    !Number.isInteger(high) ||
    high < 0 ||
    typeof critical !== "number" ||
    !Number.isInteger(critical) ||
    critical < 0
  ) {
    return ["pnpm audit: high/critical vulnerability counts must be non-negative integers"];
  }
  return { high, critical };
}

/** 报告里一条公告的形状（只取判定要用的字段，其余一律不信）。 */
interface BlockingAdvisory {
  /** GHSA id；报告没给就是 null——认不出 id 的公告无法登记，直接判红。 */
  advisoryId: string | null;
  module: string;
  severity: string;
  /** 命中的版本与依赖路径，用于报错时让人能自己去查。 */
  detail: string;
  /** 每一条 finding 都是 `dev: true` 吗。 */
  devOnly: boolean;
}

function readFindings(advisory: Record<string, unknown>): {
  detail: string;
  devOnly: boolean;
} {
  const raw = advisory.findings;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { detail: "no findings reported", devOnly: false };
  }
  const versions: string[] = [];
  const paths: string[] = [];
  let devOnly = true;
  for (const finding of raw) {
    if (!isRecord(finding)) {
      devOnly = false;
      continue;
    }
    if (finding.dev !== true) devOnly = false;
    if (typeof finding.version === "string") versions.push(finding.version);
    const findingPaths = finding.paths;
    if (Array.isArray(findingPaths)) {
      for (const entry of findingPaths) if (typeof entry === "string") paths.push(entry);
    }
  }
  const parts: string[] = [];
  if (versions.length > 0) parts.push(`version ${[...new Set(versions)].join(", ")}`);
  if (paths.length > 0) parts.push(`path ${[...new Set(paths)].join(", ")}`);
  return { detail: parts.join("; ") || "findings carry no version or path", devOnly };
}

/**
 * 从报告里取出所有会阻断的公告。
 *
 * **计数大于 0 却给不出明细时判红**：那样就无法判断它是不是已被台账登记，
 * 「无法判断」必须读成「未被登记」。
 */
// 返回值刻意不用「数组 vs 错误串」区分：两种形状都是数组，`Array.isArray` 分不开，
// 而分不开的那一版会把公告对象当成问题串打印出来（`[object Object]`）——
// 那是**看起来像门禁在抱怨、实际什么也没判**的一种坏掉。
function readBlockingAdvisories(report: Record<string, unknown>): {
  advisories: BlockingAdvisory[];
  error?: string;
} {
  const advisories = report.advisories;
  if (!isRecord(advisories)) {
    return {
      advisories: [],
      error:
        "pnpm audit: the report lists blocking advisories but carries no advisory details to " +
        "account for; re-run the audit with a registry that serves advisories",
    };
  }
  const blocking: BlockingAdvisory[] = [];
  for (const [, value] of Object.entries(advisories)) {
    if (!isRecord(value)) continue;
    const severity = typeof value.severity === "string" ? value.severity : "";
    if (!BLOCKING_SEVERITIES.has(severity)) continue;
    const { detail, devOnly } = readFindings(value);
    blocking.push({
      advisoryId: typeof value.github_advisory_id === "string" ? value.github_advisory_id : null,
      module: typeof value.module_name === "string" ? value.module_name : "(unknown module)",
      severity,
      detail,
      devOnly,
    });
  }
  return { advisories: blocking };
}

function validateExceptionShape(exception: AuditException): string | null {
  if (!ADVISORY_ID.test(exception.advisoryId)) {
    return `advisory id must look like GHSA-xxxx-xxxx-xxxx (got "${exception.advisoryId}")`;
  }
  if (exception.module.trim() === "") return "module must not be empty";
  if (!BLOCKING_SEVERITIES.has(exception.severity)) {
    return `severity must be high or critical (got "${exception.severity}")`;
  }
  if (exception.reachability.trim() === "") {
    return "reachability must state why the production surface cannot reach it";
  }
  if (exception.justification.trim() === "") {
    return "justification must state why there is nothing to upgrade to";
  }
  for (const field of ["reviewedOn", "reviewBy"] as const) {
    if (!ISO_DATE.test(exception[field])) {
      return `${field} must be YYYY-MM-DD (got "${exception[field]}")`;
    }
  }
  if (exception.reviewBy < exception.reviewedOn) {
    return `reviewBy (${exception.reviewBy}) is earlier than reviewedOn (${exception.reviewedOn})`;
  }
  return null;
}

function inspectException(
  exception: AuditException,
  blocking: readonly BlockingAdvisory[],
  today: string,
): string[] {
  const issues: string[] = [];
  const label = `dependency audit exception ${exception.advisoryId} (${exception.module})`;

  const shapeProblem = validateExceptionShape(exception);
  if (shapeProblem) {
    return [`${label}: ${shapeProblem}`];
  }
  if (exception.reviewBy < today) {
    issues.push(
      `${label}: review window ended on ${exception.reviewBy}; re-check whether a patched release ` +
        "exists, then update reviewedOn/reviewBy or delete the entry from " +
        `DEPENDENCY_AUDIT_EXCEPTIONS (${EXCEPTION_MODULE_PATH})`,
    );
  }

  const match = blocking.find((advisory) => advisory.advisoryId === exception.advisoryId);
  if (!match) {
    issues.push(
      `${label}: no longer present in the audit report; if the fix has landed, delete this ` +
        `entry from DEPENDENCY_AUDIT_EXCEPTIONS (${EXCEPTION_MODULE_PATH})`,
    );
    return issues;
  }
  if (match.module !== exception.module) {
    issues.push(
      `${label}: the report attributes this advisory to ${match.module}; a ledger entry that ` +
        "disagrees with the report is worse than no entry",
    );
  }
  if (match.severity !== exception.severity) {
    issues.push(
      `${label}: recorded as ${exception.severity} but the report says ${match.severity}`,
    );
  }
  if (!match.devOnly) {
    issues.push(
      `${label}: the report no longer marks every finding as dev-only (${match.detail}); the ` +
        "production surface can reach it, so it cannot be excepted as development-only",
    );
  }
  return issues;
}

/** 认不出 id 的公告无法登记：它们不能被任何台账条目吸收，所以直接判红。 */
function collectUnidentifiable(
  blocking: readonly BlockingAdvisory[],
  issues: string[],
): Map<string, BlockingAdvisory> {
  const byId = new Map<string, BlockingAdvisory>();
  for (const advisory of blocking) {
    if (advisory.advisoryId === null) {
      issues.push(
        `pnpm audit: ${advisory.module} (${advisory.severity}; ${advisory.detail}) has no ` +
          "github_advisory_id, so it cannot be matched against the exception ledger",
      );
      continue;
    }
    byId.set(advisory.advisoryId, advisory);
  }
  return byId;
}

/**
 * 取出会阻断的公告，并把「计数说有、明细说不出」的那一格判红。
 *
 * 计数与可枚举的公告条数必须对得上：多出来的那几条是「存在但看不见」，
 * 而看不见的东西无法登记，也就无法豁免——那正是本模块要消灭的 fail-open。
 * 宁可因为注册表改了计数口径而红，也不要在口径变化后安静地放过漏洞。
 */
function collectBlocking(report: Record<string, unknown>, blockingTotal: number): {
  advisories: BlockingAdvisory[];
  issues: string[];
} {
  if (blockingTotal === 0) return { advisories: [], issues: [] };
  const enumerated = readBlockingAdvisories(report);
  if (enumerated.error !== undefined) return { advisories: [], issues: [enumerated.error] };
  const issues: string[] = [];
  if (enumerated.advisories.length !== blockingTotal) {
    issues.push(
      `pnpm audit: blocking count ${blockingTotal} does not match the ${enumerated.advisories.length} ` +
        "advisory entries the report can enumerate; the difference cannot be accounted for",
    );
  }
  return { advisories: enumerated.advisories, issues };
}

/** 台账之外的高危/严重公告，逐条点名 id、模块与依赖路径。 */
function collectUnregistered(
  blocking: readonly BlockingAdvisory[],
  exceptions: readonly AuditException[],
  issues: string[],
): void {
  const registered = new Set(exceptions.map((exception) => exception.advisoryId));
  for (const advisory of blocking) {
    if (advisory.advisoryId === null || registered.has(advisory.advisoryId)) continue;
    issues.push(
      `pnpm audit: ${advisory.advisoryId} (${advisory.module}, ${advisory.severity}; ` +
        `${advisory.detail}) is not registered in DEPENDENCY_AUDIT_EXCEPTIONS ` +
        `(${EXCEPTION_MODULE_PATH}): upgrade the dependency, or register why there is nothing ` +
        "to upgrade to",
    );
  }
}

/**
 * 判定一份 `pnpm audit --json` 报告，返回读数或问题清单。
 *
 * @param options.exceptions 台账（默认 `DEPENDENCY_AUDIT_EXCEPTIONS`）。
 * @param options.today `YYYY-MM-DD`，用于复核期限；默认由调用方注入以便测试确定化。
 */
export function inspectDependencyAudit(
  report: unknown,
  options: { exceptions?: readonly AuditException[]; today?: string } = {},
): DependencyAuditVerdict | string[] {
  const exceptions = options.exceptions ?? DEPENDENCY_AUDIT_EXCEPTIONS;
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  if (!isRecord(report)) return ["pnpm audit: report must be a JSON object"];
  const counts = readCounts(report);
  if (Array.isArray(counts)) return counts;
  const blockingTotal = counts.high + counts.critical;

  const collected = collectBlocking(report, blockingTotal);
  const issues: string[] = [...collected.issues];
  const byId = collectUnidentifiable(collected.advisories, issues);

  const excepted: string[] = [];
  for (const exception of exceptions) {
    const exceptionIssues = inspectException(exception, collected.advisories, today);
    issues.push(...exceptionIssues);
    if (byId.has(exception.advisoryId) && exceptionIssues.length === 0) {
      excepted.push(exception.advisoryId);
    }
  }
  collectUnregistered(collected.advisories, exceptions, issues);

  // 计数摘要本身不是问题：它只在真的要报错时作为第一行出现。
  // 把它无条件推进 issues，「全部已登记」的情形就会报红——那等于逼着人去删台账。
  if (issues.length === 0) return { high: counts.high, critical: counts.critical, excepted: excepted.sort() };
  if (blockingTotal === 0) return issues;
  return [
    `pnpm audit: ${counts.critical} critical, ${counts.high} high vulnerabilities`,
    ...issues,
  ];
}

/**
 * 工作流里不许再出现裸的 `pnpm audit`。
 *
 * 这条规则是被 CI 抓出来的，不是设计出来的：第一次修这个问题时只改了
 * `security-config.yml`（当时 grep 的是「哪些工作流提到 `check:security`」），
 * 而 `ci.yml` 里还有一步一模一样的裸审计，于是同一个 PR 的 CI 仍然红。
 * **一次真实发生过的缺陷形状，不该在另一个地方裸奔**——这与 #191 在 `AGENTS.md` 上、
 * #195 在文档链接上做的是同一件事。
 *
 * 之所以要禁而不是「要求某一步存在」：裸命令看起来更严格（它就是官方审计），
 * 但它**绕开了例外台账**，于是「上游没有补丁」这一种真实且不可修的情况会让它永远红。
 * 一条没人能修的门禁不是严格，是失效。
 *
 * **注释不算命令**：判定先去掉整行注释再扫。不这么做的话，我们自己为了解释这条规则
 * 而写下的 `pnpm audit --audit-level high` 字样会把门禁顶红——那正是 workflow-policy
 * 踩过的同一类假红（注释不是配置）。
 */
// `pnpm --silent audit`、`pnpm audit --audit-level high` 都算；
// `pnpm audit:storage-orphans` 不算——那是本仓库的另一个脚本，`audit` 后面跟的是 `:`。
const BARE_AUDIT_COMMAND = /\bpnpm\s+(?:--?[a-zA-Z][\w-]*\s+)*audit(?![\w:-])/;

function stripCommentLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => /^\s*#/.test(line) === false)
    .join("\n");
}

export function inspectBareAuditCommands(
  files: readonly { path: string; content: string }[],
): string[] {
  const issues: string[] = [];
  for (const file of files) {
    const line = stripCommentLines(file.content)
      .split("\n")
      .find((candidate) => BARE_AUDIT_COMMAND.test(candidate));
    if (line === undefined) continue;
    issues.push(
      `${file.path}: runs a bare \`pnpm audit\` (${line.trim()}); it cannot see the ` +
        "no-patch-available exception ledger, so it fails forever on advisories that have no " +
        `fix. Use \`pnpm check:audit\` (or \`pnpm check:security\`) instead`,
    );
  }
  return issues;
}
