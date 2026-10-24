/**
 * CodeQL 告警台账与实况的对账判定。
 *
 * 起因是 `docs/operations/codeql-alert-triage.md` 里那句被登记了 **30 天**的话
 * （2026-09-13 `536c3ea3` 写入 → 2026-10-13 否证）：
 * 「告警计数与对比需要 GitHub 安全 API，**本地无法复现**」。
 * 2026-10-13 实测：本机 `gh` 就能读到全部 5 条 open 告警及其严重度、创建时间、
 * 实例位置与 dismissal 状态。**「无法复现」是错的**——真正缺的不是权限，是没人写这个探测。
 * 于是「零回归」这个结论从来没有被任何自动检查核对过：
 * 2026-09-24 那 4 条 `js/log-injection` 就是这么挂了 5 天没人发现（见台账 2026-09-24 条目）。
 *
 * ## 一个必须先说清的坑（我自己踩过**两次**，第一次还写错了原因）
 *
 * 严重度字段的真名是 `rule.security_severity_level`——**它在 `rule` 下面，不在告警顶层**。
 * 顶层**根本没有这个键**（实测：`'security_severity_level' in alert === False`），
 * 所以取 `alert.security_severity_level` 得到的是 `undefined`，
 * 序列化后长得像 `null`，于是看起来完全像是「GitHub 没给这条告警评分」。
 *
 * **我第一次把这个坑归错了原因**，写成「它只在带 `x-github-api-version: 2022-11-28` 时才有值」。
 * 那是错的，而且错得很典型：我拿 `gh api` 测「不带 header」这一组，
 * 而 **`gh` 自己会补一个默认 api-version**，所以那组根本不是「不带 header」——
 * 两组都带了 header，差异当然不在 header 上。改用 `curl` 严格对照后：
 *   - 不带 header / 带 `2022-11-28` / 带 `2026-03-10` ⇒ `rule.security_severity_level` **全都是 `high` / `medium`**
 *   - 不带 header 时 GitHub 实际选用的版本由响应头 `x-github-api-version-selected` 给出，
 *     实测就是 `2022-11-28` ⇒ 这个 header 对本端点**不是**充分条件也不是必要条件
 *   - 带一个不受支持的版本（如 `2023-03-02`）⇒ **HTTP 400**，不是 `null`。
 *     错误信息逐字为：`supported versions are "2026-03-10" (most recent) and "2022-11-28"`
 * ⇒ header 该带还是带着（`gh` 与 `curl` 都默认落在 2022-11-28，带着它可复现），
 *   但**它不是这个坑的成因**。真正的成因只有一个：字段取错了嵌套层级。
 *
 * 顺带一条同样实测过的：查询参数 `severity=` 过滤的是 **`security_severity_level`**
 * 而不是 `rule.severity`（`severity=high` 只回 #18，而 #18 的 `rule.severity` 是 `warning`）。
 * 更值得防的是它**对无法识别的取值静默忽略**：`severity=low`/`critical` 回 0 条（合法值、确实没有），
 * 但 `severity=error` / `nonsense` / `none` / `info` 一律回**全部 5 条** ⇒
 * 拼错的过滤器看起来像「生效了且全都命中」。**所以别用查询参数筛严重度，取回来自己判。**
 * （`security_severity_level=` 这个参数则被完全忽略，任何取值都回全部 5 条。）
 *
 * 本模块**拒绝**把 `null` 当成「低危」：它判成「未知」，由调用方归退出码 2。
 *
 * ## 判据
 *
 *   1. **实况有、台账没有** ⇒ 未登记的告警（红）。这条是「零回归」的正向形态。
 *   2. **台账有、实况没有** ⇒ 台账腐烂（红）。登记簿里躺着已关闭的告警，
 *      会让人以为「这些还在」，比没登记更糟。
 *   3. **登记不完整** ⇒ 缺判定人 / 日期 / 证据链接 / issue（红）。
 *      runbook 的 Dismissal 规则要求每条都留下这三样，缺一样就是没分诊完。
 *   4. **复核期限过了** ⇒ 红。沿用 `dependency-audit` 的例外台账约定：
 *      「我答应在某天之前重新查一遍」，到点不查就变红。
 *   5. **阻断级告警还开着** ⇒ 红。runbook 写「≥7.0 必须在合并前修复」，
 *      而 `high` / `critical` 就落在这个区间。假阳性也要走 dismissal 才算结案——
 *      **判定为假阳性 ≠ 告警已处置**，这条区别正是 #18 现在的状态。
 *   6. **超过分诊 SLA** ⇒ 红。runbook 的 5 个工作日从 `created_at` 起算。
 *
 * 全部为纯函数：不读文件、不发请求。IO 在 `scripts/lib/codeql-alert-check.js`。
 */

/** 台账里的一条登记。 */
export interface AlertRegistryEntry {
  /** GitHub 告警编号（`/security/code-scanning/{number}` 的那个 number）。 */
  number: number;
  /** 规则 ID，例如 `js/log-injection`。用来抓「编号复用」：告警可能被删重建。 */
  ruleId: string;
  /** 判定结论。 */
  verdict: "true-positive" | "false-positive" | "will-fix" | "triaging";
  /** 判定人。 */
  decidedBy: string;
  /** 判定日期 `YYYY-MM-DD`。 */
  decidedOn: string;
  /** 证据：issue 编号或 URL。runbook 要求「贴出证据」。 */
  evidence: string;
  /** 复核期限 `YYYY-MM-DD`；过了这天门禁就红。 */
  reviewBy: string;
  /** 为什么还没结案（可选，但 verdict 为 triaging 时必填，由门禁判）。 */
  note?: string;
}

/** API 返回的一条告警（已裁剪到判定需要的字段）。 */
export interface LiveAlert {
  number: number;
  ruleId: string;
  /** GitHub 的 `rule.severity`：`error` / `warning` / `note`。 */
  severity: string;
  /**
   * GitHub 的 `rule.security_severity_level`（`low`/`medium`/`high`/`critical`）。
   * **只存在于 `rule` 下面**——顶层没有这个键，从顶层取会稳定得到 null。
   */
  securitySeverityLevel: string | null;
  state: string;
  /** `YYYY-MM-DD`。 */
  createdAt: string;
  /** 最近实例指向的文件，用于人工定位。 */
  path: string | null;
  /** dismissal 状态（open 告警通常为 null）。 */
  dismissedReason: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** API 原始响应的形状（未裁剪）；只声明本模块会读的那几个字段。 */
interface RawAlert {
  number?: unknown;
  state?: unknown;
  created_at?: unknown;
  dismissed_reason?: unknown;
  rule?: unknown;
  most_recent_instance?: unknown;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * 把 GitHub 的一条原始告警裁剪成 `LiveAlert`。
 *
 * **这个函数从 `scripts/lib/codeql-alert-check.js` 搬进来是有原因的**：
 * 它是「字段在哪一层」的唯一决定点，而它原先在 IO 层 ⇒ 按本仓库惯例（规则进 `src/lib/**`
 * 才有单测，IO 留在 `scripts/lib`）它**一行测试都没有**。
 * 我据此把一句错误的因果解释写进了 main（以为 `null` 来自缺 api-version header，
 * 真相是取错了嵌套层级），而没有任何检查能拦住那种注释。
 *
 * 严重度**只从 `rule` 下面取**。顶层的同名键不存在——
 * 若在这里改成从顶层取，`toLiveAlert.test.ts` 会立刻红。
 */
export function toLiveAlert(raw: RawAlert): LiveAlert {
  const rule = (typeof raw.rule === "object" && raw.rule !== null ? raw.rule : {}) as Record<string, unknown>;
  const instance =
    typeof raw.most_recent_instance === "object" && raw.most_recent_instance !== null
      ? (raw.most_recent_instance as Record<string, unknown>)
      : {};
  const location =
    typeof instance.location === "object" && instance.location !== null
      ? (instance.location as Record<string, unknown>)
      : {};
  const createdAt = asString(raw.created_at);
  return {
    number: typeof raw.number === "number" ? raw.number : Number(raw.number),
    ruleId: asString(rule.id),
    severity: asString(rule.severity),
    // **原样带回 null**：把「拿不到」洗成「低」是这个探测最坏的失败方式。
    // 注意取的是 `rule.security_severity_level`——**顶层没有这个键**。
    securitySeverityLevel: asStringOrNull(rule.security_severity_level),
    state: asString(raw.state),
    createdAt: ISO_DATE.test(createdAt.slice(0, 10)) ? createdAt.slice(0, 10) : "",
    path: asStringOrNull(location.path),
    dismissedReason: asStringOrNull(raw.dismissed_reason),
  };
}

export type CodeqlAlertIssueCode =
  | "CODEQL_ALERT_UNREGISTERED"
  | "CODEQL_ALERT_STALE_ENTRY"
  | "CODEQL_ALERT_RULE_MISMATCH"
  | "CODEQL_ALERT_INCOMPLETE_ENTRY"
  | "CODEQL_ALERT_REVIEW_OVERDUE"
  | "CODEQL_ALERT_BLOCKING_OPEN"
  | "CODEQL_ALERT_TRIAGE_SLA_BREACHED"
  | "CODEQL_ALERT_SEVERITY_UNKNOWN"
  | "CODEQL_ALERT_LIVE_UNREADABLE";

export interface CodeqlAlertIssue {
  code: CodeqlAlertIssueCode;
  message: string;
}

export interface CodeqlAlertReport {
  issues: CodeqlAlertIssue[];
  stats: {
    registered: number;
    live: number;
    unregistered: number;
    stale: number;
  };
}

/**
 * runbook 的「≥7.0 阻断」落在 GitHub 分类里的哪几档。
 *
 * GitHub 的映射：`low` < 4.0、`medium` 4.0–6.9、`high` 7.0–8.9、`critical` ≥ 9.0。
 * 所以阻断档是 `high` 与 `critical`。**这是映射，不是原值**——
 * API 给的是分类字符串而不是 0–10 的分值，runbook 那张表写的是分值。
 * 这层口径差已写进 runbook，免得下一个人以为能拿到小数。
 */
export const BLOCKING_SEVERITY_LEVELS: ReadonlySet<string> = new Set(["high", "critical"]);

/** 分诊 SLA（工作日），与 `CODEQL_CONTRACT.triageSlaDays` 同源。 */
export const TRIAGE_SLA_WORKDAYS = 5;

function parseDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 从 `from` 到 `to` 之间过了多少个工作日（含首尾，跳过周六周日）。
 *
 * 为什么自己数而不是用日历天数：runbook 写的是「5 个**工作日**」，
 * 按日历天数算会让周五出现的告警在下周二就「超期」，那种红没人会服。
 * 法定节假日不在范围内——它只会让判定更宽松，不会造成假红。
 */
export function workingDaysBetween(from: string, to: string): number | null {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start === null || end === null) return null;
  if (end < start) return 0;
  const MS_PER_DAY = 86_400_000;
  let days = 0;
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += MS_PER_DAY) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** 登记完整性检查；返回缺少的字段名，空数组表示完整。 */
export function missingEntryFields(entry: AlertRegistryEntry): string[] {
  const missing: string[] = [];
  if (!Number.isInteger(entry.number) || entry.number <= 0) missing.push("number");
  if (typeof entry.ruleId !== "string" || entry.ruleId.trim() === "") missing.push("ruleId");
  if (typeof entry.decidedBy !== "string" || entry.decidedBy.trim() === "") missing.push("decidedBy");
  if (typeof entry.evidence !== "string" || entry.evidence.trim() === "") missing.push("evidence");
  if (parseDate(entry.decidedOn) === null) missing.push("decidedOn");
  if (parseDate(entry.reviewBy) === null) missing.push("reviewBy");
  // 「还在分诊」这个结论必须配一句「为什么还没结案」，否则它和没判定无法区分。
  if (entry.verdict === "triaging" && (typeof entry.note !== "string" || entry.note.trim() === "")) {
    missing.push("note");
  }
  return missing;
}

/**
 * 分诊 SLA：只有「仍未结案」的登记才谈超期。
 *
 * 已结案（true-positive 已修、false-positive 已 dismissal）的不算超期——
 * 那已经是结论了，再拿 created_at 去卡它就是假红。
 */
function slaIssue(alert: LiveAlert, entry: AlertRegistryEntry, today: string): CodeqlAlertIssue | null {
  if (entry.verdict !== "triaging") return null;
  const elapsed = workingDaysBetween(alert.createdAt, today);
  if (elapsed === null || elapsed <= TRIAGE_SLA_WORKDAYS) return null;
  return {
    code: "CODEQL_ALERT_TRIAGE_SLA_BREACHED",
    message:
      `告警 #${alert.number} 出现于 ${alert.createdAt}，到今天已过 ${elapsed} 个工作日` +
      `，登记仍是 triaging（SLA = ${TRIAGE_SLA_WORKDAYS} 个工作日）`,
  };
}

/**
 * 台账自身的体检：不依赖实况就能判的部分。
 *
 * 拆开是因为「登记不完整」和「复核过期」只看登记簿本身，与 GitHub 此刻有没有告警无关——
 * 就算实况读取失败，这两类问题也必须报出来，否则探测挂掉会顺带掩盖台账腐烂。
 */
function registrySelfIssues(registry: readonly AlertRegistryEntry[], today: string): CodeqlAlertIssue[] {
  const issues: CodeqlAlertIssue[] = [];
  for (const entry of registry) {
    const missing = missingEntryFields(entry);
    if (missing.length > 0) {
      issues.push({
        code: "CODEQL_ALERT_INCOMPLETE_ENTRY",
        message: `告警 #${entry.number} 的登记缺少 ${missing.join(" / ")}——runbook 要求每条都留下判定人、日期与证据`,
      });
    }
    if (parseDate(entry.reviewBy) !== null && entry.reviewBy < today) {
      issues.push({
        code: "CODEQL_ALERT_REVIEW_OVERDUE",
        message: `告警 #${entry.number} 的复核期限 ${entry.reviewBy} 已过（今天 ${today}）——台账是「答应某天重新查一遍」，不是免死牌`,
      });
    }
  }
  return issues;
}

/**
 * 对账「台账登记」与「GitHub 实况」。
 *
 * `live === null` 表示**没读到**（缺 token、网络失败、API 换形状）。
 * 此时只报一条 `CODEQL_ALERT_LIVE_UNREADABLE` 并让调用方以退出码 2 结束：
 * 读不到告警列表既不是「零告警」也不是「无新增」——
 * **把「拿不到数据」显示成「一切正常」是这条探测最坏的失败方式**。
 */
export function inspectCodeqlAlerts(
  registry: readonly AlertRegistryEntry[],
  live: LiveAlert[] | null,
  today: string,
): CodeqlAlertReport {
  const issues: CodeqlAlertIssue[] = registrySelfIssues(registry, today);
  const emptyStats = {
    registered: registry.length,
    live: 0,
    unregistered: 0,
    stale: 0,
  };

  if (live === null) {
    issues.push({
      code: "CODEQL_ALERT_LIVE_UNREADABLE",
      message:
        "读不到 GitHub 的 code-scanning 告警列表（缺 token、网络失败、或 API 换了形状）——" +
        "**未知不算通过**，但也不能据此断言「零回归」。" +
        "注意严重度在 `rule.security_severity_level` 下——顶层没有这个键。",
    });
    return { issues, stats: emptyStats };
  }

  const open = live.filter((alert) => alert.state === "open");
  const byNumber = new Map(open.map((alert) => [alert.number, alert]));
  const registeredNumbers = new Set(registry.map((entry) => entry.number));

  // 1) 实况有、台账没有 ⇒ 未登记
  for (const alert of open) {
    if (registeredNumbers.has(alert.number)) continue;
    issues.push({
      code: "CODEQL_ALERT_UNREGISTERED",
      message:
        `告警 #${alert.number}（${alert.ruleId}，severity=${alert.securitySeverityLevel ?? "未知"}/` +
        `${alert.severity}，${alert.path ?? "位置未知"}，出现于 ${alert.createdAt}）` +
        "**在台账里没有登记**——「零回归」此刻不成立",
    });
  }

  for (const entry of registry) {
    const alert = byNumber.get(entry.number);
    // 2) 台账有、实况没有 ⇒ 腐烂
    if (alert === undefined) {
      issues.push({
        code: "CODEQL_ALERT_STALE_ENTRY",
        message:
          `告警 #${entry.number} 在台账里，但 GitHub 的 open 列表里没有它` +
          "——它已关闭或编号变了。留着会让人以为「这些还在」，比没登记更糟",
      });
      continue;
    }
    // 编号对得上但规则不同 ⇒ 告警被删重建，台账里那套结论已经不属于这条
    if (entry.ruleId !== alert.ruleId) {
      issues.push({
        code: "CODEQL_ALERT_RULE_MISMATCH",
        message:
          `告警 #${entry.number} 台账写的是 ${entry.ruleId}，实况是 ${alert.ruleId}` +
          "——编号被复用（告警删过重建），台账里那套分诊结论已经不属于这条了",
      });
    }
    // 5) 阻断级还开着
    const level = (alert.securitySeverityLevel ?? "").toLowerCase();
    if (level === "") {
      issues.push({
        code: "CODEQL_ALERT_SEVERITY_UNKNOWN",
        message:
          `告警 #${alert.number} 拿不到 rule.security_severity_level——` +
          "**这不是「低危」**。先确认取的是 `rule` 下面的那个键：顶层没有同名字段，" +
          "从顶层取会稳定得到 null，而那不是「没评分」",
      });
    } else if (BLOCKING_SEVERITY_LEVELS.has(level) && alert.dismissedReason === null) {
      issues.push({
        code: "CODEQL_ALERT_BLOCKING_OPEN",
        message:
          `告警 #${alert.number}（${alert.ruleId}）严重度 ${level} ≥ 阻断阈值，` +
          "但仍是 open 且未 dismissal。runbook：「≥7.0 必须在合并前修复；未修复不得进入 main」" +
          "——**判定为假阳性 ≠ 已处置**，假阳性也要 dismissal 或修掉才算结案",
      });
    }
    // 6) SLA：只有仍未结案的登记才谈超期
    const sla = slaIssue(alert, entry, today);
    if (sla !== null) issues.push(sla);
  }

  return {
    issues,
    stats: {
      registered: registry.length,
      live: open.length,
      unregistered: open.filter((alert) => !registeredNumbers.has(alert.number)).length,
      stale: registry.filter((entry) => !byNumber.has(entry.number)).length,
    },
  };
}

/**
 * 已分诊告警的登记簿。
 *
 * **加一条之前先读这段**（与 `DEPENDENCY_AUDIT_EXCEPTIONS` 同一条规矩）：
 * 这里不是告警白名单，而是「我知道它红、我查过它为什么红、而且我答应在某天之前
 * 重新查一遍」的登记簿。判定为假阳性**不等于结案**——runbook 要求留下判定人、
 * 日期与证据，而 GitHub 侧的 dismissal 要 maintainer 决定。
 * 两者都没做之前，这条登记只能是 `triaging`，而 `triaging` 会被 SLA 判红。
 *
 * 这正是 #18 此刻的状态：2026-10-12 分诊为假阳性（证据在 issue #242），
 * 但**没有 dismissal**，所以它仍然应该红。把「我判过了」写成「已处置」，
 * 就是本仓库那条「假绿比假红贵」的规矩要拦的事。
 */
export const CODEQL_ALERT_REGISTRY: readonly AlertRegistryEntry[] = [
  {
    number: 11,
    ruleId: "js/log-injection",
    verdict: "true-positive",
    decidedBy: "Sun1090",
    decidedOn: "2026-09-24",
    evidence: "issue #132",
    // 修复已合并（`600af8a1`）但告警仍在：CodeQL 看不见自定义 sanitizer，
    // 所以这条的结案条件是「数据流被 CodeQL 认出来」或 dismissal，见 runbook
    // 「修复已合并但告警仍在」一节。期限到了要回去看一眼有没有自动关掉。
    reviewBy: "2026-11-15",
    note: "已修但告警未关闭——sanitizer 对 CodeQL 不可见",
  },
  {
    number: 12,
    ruleId: "js/log-injection",
    verdict: "true-positive",
    decidedBy: "Sun1090",
    decidedOn: "2026-09-24",
    evidence: "issue #132",
    reviewBy: "2026-11-15",
    note: "同 #11",
  },
  {
    number: 13,
    ruleId: "js/log-injection",
    verdict: "true-positive",
    decidedBy: "Sun1090",
    decidedOn: "2026-09-24",
    evidence: "issue #132",
    reviewBy: "2026-11-15",
    note: "同 #11",
  },
  {
    number: 17,
    ruleId: "js/log-injection",
    verdict: "true-positive",
    decidedBy: "Sun1090",
    // **不是 09-24**：#17 出现于 2026-09-27（API 的 created_at），09-24 那批分诊
    // 覆盖的是 #11–#14。它的结论来自 2026-10-11 那一节 runbook
    // 「修复已合并但告警仍在」，那节明确点名 #11/#12/#13/#17 是同一现象。
    decidedOn: "2026-10-11",
    evidence: "issue #132 + codeql-alert-triage.md「修复已合并但告警仍在」",
    reviewBy: "2026-11-15",
    note: "同 #11（sanitizer 对 CodeQL 不可见），实例在 src/lib/logger.ts:118",
  },
  {
    number: 18,
    ruleId: "js/insufficient-password-hash",
    // **不是 false-positive**：判定确实是假阳性，但结案条件没满足——
    // 没有 dismissal，而 runbook 说例外只能走 dismissal。
    verdict: "triaging",
    decidedBy: "Sun1090",
    decidedOn: "2026-10-12",
    evidence: "issue #242",
    reviewBy: "2026-11-12",
    note:
      "分诊为假阳性（命中处哈希的是 24 字节随机 token ⇒ 192 位熵，不是口令），" +
      "但 dismissal 要 maintainer 决定，故仍未结案。严重度 high ⇒ 落在阻断档。",
  },
  {
    number: 19,
    ruleId: "js/file-access-to-http",
    // 与 #18 同一状态：判定为「按预期设计」（迁移文件 → Management API 是工具本职，
    // 内容被 manifest SHA-256 锁定、默认 dry-run、不在任何自动流程里），
    // 但没有 dismissal，所以仍按 triaging 登记。
    verdict: "triaging",
    decidedBy: "Sun1090",
    decidedOn: "2026-10-24",
    evidence: "issue #271",
    reviewBy: "2026-11-21",
    note:
      "分诊为按预期设计（读的是 manifest 锁定的仓库迁移文件，端点为常量，" +
      "威胁模型里攻击者若能改文件就已拥有整个仓库），dismissal 待 maintainer 决定。" +
      "严重度 medium，不在阻断档。",
  },
];
