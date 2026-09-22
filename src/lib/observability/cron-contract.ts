/**
 * cron worker 调度与指标契约（E03）。
 *
 * 背景：cron worker 有三类典型静默失效，静态类型和普通单测都发现不了——
 *
 *   1. **没被调度**：路由写完了、文档也写了，但 `vercel.json` 里没有条目。
 *      项目真实发生过：`/api/cron/digest` 长期只在文档里写「由外部 cron 调用」，
 *      没有任何调度器真的调用它，通知邮件整条链路在生产上是死的。
 *   2. **调度漂移**：`vercel.json` 的表达式写错或与文档/注册表不一致
 *      （如 `0 25 * * *`），平台会接受部署但不触发。
 *   3. **指标缺失**：路由被调度了，但某条失败分支没有 `recordMetric`，
 *      或者指标名改了而告警文档没改，看板上就是一片安静。
 *
 * 本模块把「谁被调度、用什么表达式、要上报哪些指标」写成一份可执行的注册表，
 * 规则本体是纯函数（不读文件系统、不碰网络；源码以字符串传进来）；IO 收集在
 * `scripts/lib/cron-contract-check.js`，入口是 `pnpm check:cron-contract`。
 *
 * 规则只判断调度与指标是否接线，不判断 worker 的业务逻辑是否正确。
 * 例外是第 4 类失败（A04）：**按用户条件跳过投递却不计数**。digest 的错峰门控就是这一类，
 * 它让 `src/lib/observability/cron-skip-coverage.ts` 成为本契约的一部分——静态检查每条
 * 带条件的 `continue` 是否留下了计数证据，让「静默不投递」在 PR 阶段就失败。
 *
 * 调度表达式校验器是手写的最小实现（5 字段：分 时 日 月 周），
 * 引入 `cron-parser` 之类的依赖对「只校验注册表里这几条固定表达式」来说不划算。
 */

import { auditCronSkips } from "./cron-skip-coverage.ts";

/** 鉴权拒绝计数指标：所有 cron worker 的 401 分支都必须上报。 */
export const CRON_REJECTED_METRIC = "cron.auth.rejected";

/** cron route 目录（仓库相对 POSIX 路径），用于发现未注册的 worker。 */
export const CRON_ROUTE_DIRECTORY = "src/app/api/cron";

/** 指标与调度契约文档（运维视角的单一入口）。 */
export const CRON_OPERATIONS_DOC = "docs/operations/sentry-alerts.md";

/** 文档对仓库核对的默认目录（D01）；带日期的快照由 `isCronDocAuditable` 排除。 */
export const CRON_DOC_DIRECTORY = "docs-site";

/** 参与核对的一篇文档。 */
export interface CronDocSource {
  /** 仓库相对 POSIX 路径。 */
  path: string;
  content: string;
}

/** worker 标识：作为 `cron.auth.rejected` 的维度，禁止含用户或环境数据。 */
export type CronWorkerId = "digest" | "push-retry" | "retention";

export type CronMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CronWorkerContract {
  /** 稳定标识，与指标属性里的 `worker` 取值一致。 */
  id: CronWorkerId;
  /** 调度平台使用的路径。 */
  path: string;
  /** 路由文件（仓库相对 POSIX 路径）。 */
  routeFile: string;
  /** 路由导出的 HTTP 方法，每个都必须真实存在。 */
  methods: readonly CronMethod[];
  /** 平台调度表达式（5 字段，UTC）。注册表是唯一事实源，`vercel.json` 必须逐字一致。 */
  schedule: string;
  /** 每轮运行必须上报的指标名（不含鉴权拒绝指标）。 */
  metrics: readonly string[];
  /**
   * 用于「按条件跳过」计数的指标（必须是 `metrics` 的子集，A04）。
   * 路由里每条带条件的 `continue` 都要在分支里上报其中之一（并带 `reason` 维度），
   * 否则被跳过的条目在指标上完全静默——digest 的错峰门控就是这样藏住 P0 的。
   * 没有条件跳过的 worker 显式写 `[]`。
   */
  skipMetrics: readonly string[];
  /** 单轮语义说明，供文档核对阅读，不参与规则判定。 */
  cadence: string;
}

/** 当前仓库的 cron worker 注册表。新增 worker 时先登记这里，再改路由。 */
export const CRON_WORKERS: readonly CronWorkerContract[] = [
  {
    id: "digest",
    path: "/api/cron/digest",
    routeFile: "src/app/api/cron/digest/route.ts",
    methods: ["POST"],
    schedule: "0 9 * * *",
    metrics: [
      "email.backlog",
      "cron.digest.skipped",
      "cron.digest.receipt_failed",
      "cron.digest.completed",
      "cron.digest.failed",
    ],
    skipMetrics: ["cron.digest.skipped"],
    // 2026-09-22 去掉本地 08:00 错峰门控：Hobby 每天只能调度一次，那个条件让除 UTC-1 外的
    // 用户永远收不到摘要。现在的语义就是一天一封、在调度时刻送达，不贴合用户本地时区。
    cadence: "每天 09:00 UTC 拉取一次，给每个有待发邮件通知的用户发一封摘要（发送时刻不随用户时区变化）",
  },
  {
    id: "push-retry",
    path: "/api/cron/push-retry",
    routeFile: "src/app/api/cron/push-retry/route.ts",
    methods: ["GET", "POST"],
    schedule: "0 22 * * *",
    metrics: [
      "push.backlog",
      "push.queue.pruned",
      "push.queue.prune_failed",
      "cron.push-retry.completed",
      "cron.push-retry.failed",
    ],
    skipMetrics: [],
    cadence: "每天 22:00 UTC 重试一次待投递 Push 并执行保留策略清理",
  },
  {
    id: "retention",
    path: "/api/cron/retention",
    routeFile: "src/app/api/cron/retention/route.ts",
    methods: ["POST"],
    schedule: "0 5 * * *",
    metrics: [
      "cron.retention.completed",
      "cron.retention.failed",
      "cron.retention.cleanup_failed",
      "storage.orphan.objects",
      "storage.orphan.unowned",
    ],
    skipMetrics: [],
    cadence:
      "每天 05:00 UTC 执行全部保留期清理函数，并只读巡检存储孤儿；取代未安装的 pg_cron 周调度，且与其并存时保持幂等",
  },
];

/**
 * 免于 cron worker 契约的平台调度：保留用途必须写明。
 *
 * 这两条不是 worker（不落队列、不产业务指标），而是平台级保活/兜底：
 *   - `/api/health`：Supabase 免费版保活探测；
 *   - `/api/ops/supabase-restore`：保活失败后的分层恢复入口。
 * 登记豁免是为了让「vercel.json 出现未注册路径」永远意味着有人漏登记，而不是噪声。
 */
export const CRON_SCHEDULE_EXEMPTIONS: Readonly<Record<string, string>> = {
  "/api/health": "Supabase 免费版保活探测：无队列、无业务指标",
  "/api/ops/supabase-restore": "保活失败后的分层恢复入口：由运维按需触发，不产 worker 指标",
};

export interface PlatformCron {
  path: string;
  schedule: string;
}

export interface CronContractInput {
  /** 注册表；默认取 `CRON_WORKERS`，测试可注入。 */
  workers?: readonly CronWorkerContract[];
  /** 免于 worker 契约的平台调度；默认取 `CRON_SCHEDULE_EXEMPTIONS`。 */
  excludedSchedules?: Readonly<Record<string, string>>;
  /** 实际存在的 cron 路由文件（仓库相对 POSIX 路径）。 */
  routeFiles: readonly string[];
  /** 路由源码，键为仓库相对路径；缺失即视为空源码并报错。 */
  sources: Readonly<Record<string, string>>;
  /** `vercel.json` 的 `crons` 数组。 */
  platformCrons: readonly PlatformCron[];
  /** 运维文档内容（指标契约表 + 调度契约表）。 */
  operationsDoc: string;
  /**
   * 参与 D01 核对的文档（`docs-site/**` 与 `docs/**`）。
   * 不传即不核对（单测只验 worker 时用）；传空数组是失败封闭——收集规则坏掉时
   * 不能把「一篇都没读到」当成「没有漂移」。
   */
  docs?: readonly CronDocSource[];
  /** 不属于 worker、但确实存在于仓库里的调度表达式（GitHub workflow 的 `schedule`）。 */
  externalSchedules?: readonly string[];
}

export type CronContractIssueCode =
  | "CRON_NO_WORKERS"
  | "CRON_ROUTE_MISSING"
  | "CRON_ROUTE_UNDECLARED"
  | "CRON_METHOD_MISSING"
  | "CRON_SCHEDULE_INVALID"
  | "CRON_SCHEDULE_MISSING"
  | "CRON_SCHEDULE_DUPLICATE"
  | "CRON_SCHEDULE_DRIFT"
  | "CRON_SCHEDULE_ORPHAN"
  | "CRON_SCHEDULE_PLATFORM_UNSUPPORTED"
  | "CRON_METRIC_MISSING"
  | "CRON_METRIC_UNDOCUMENTED"
  | "CRON_SKIP_METRIC_UNDECLARED"
  | "CRON_SKIP_UNCOUNTED"
  | "CRON_SKIP_REASON_MISSING"
  | "CRON_SKIP_UNPARSEABLE"
  | "CRON_REJECTION_UNOBSERVABLE"
  | "CRON_DOC_SCHEDULE_MISSING"
  | "CRON_DOC_STALE_SCHEDULE"
  | "CRON_DOC_UNREGISTERED_PATH"
  | "CRON_DOC_SOURCE_EMPTY"
  | "CRON_DOC_NO_SOURCES"
  | "CRON_STALE_EXEMPTION";

export interface CronContractIssue {
  code: CronContractIssueCode;
  /** 出问题的 worker（或路由文件/指标名），用于快速定位。 */
  subject: string;
  message: string;
}

export interface CronContractReport {
  issues: CronContractIssue[];
  /** 参与审计的 worker id（排序后）。 */
  workers: string[];
  /** 参与审计的指标名（去重排序后）。 */
  metrics: string[];
  /** 平台调度路径（排序后，含豁免项）。 */
  scheduledPaths: string[];
  /** 走 worker 契约的调度路径（排序后）。 */
  workerPaths: string[];
  /** 实际参与「文档 vs 仓库」核对的文档篇数；0 表示调用方没传 `docs`。 */
  docPages: number;
  /** 仍存在的平台级豁免路径（排序后）。 */
  exemptedPaths: string[];
  /** 全部 worker 路由里「带条件的 continue 跳过」分支数（A04 的核对面）。 */
  skipBranches: number;
}

/** 每个字段的取值范围：分 时 日 月 周（周接受 0 与 7 表示周日）。 */
const SCHEDULE_FIELD_RANGES: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function isIntegerInRange(text: string, min: number, max: number): boolean {
  if (!/^\d{1,2}$/.test(text)) return false;
  const value = Number(text);
  return value >= min && value <= max;
}

/** 单个字段片段：通配、枚举、`A-B` 范围、通配步进与范围步进；`N/step` 视为非法以免歧义。 */
function isValidFieldPart(part: string, min: number, max: number): boolean {
  const pieces = part.split("/");
  if (pieces.length > 2) return false;
  const [rangeText, stepText] = pieces;
  if (stepText !== undefined) {
    if (!/^\d{1,2}$/.test(stepText)) return false;
    const step = Number(stepText);
    if (step < 1 || step > max) return false;
  }
  if (rangeText === "*") return true;
  const bounds = rangeText.split("-");
  if (bounds.length > 2) return false;
  const [startText, endText] = bounds;
  if (!isIntegerInRange(startText, min, max)) return false;
  if (endText === undefined) return stepText === undefined;
  if (!isIntegerInRange(endText, min, max)) return false;
  return Number(startText) <= Number(endText);
}

/**
 * Vercel Hobby plan 的 Cron Jobs 限制：每个路径每天最多运行一次。
 *
 * 平台会接受更频繁的表达式，但部署预览/生产更新时拒绝部署并给出
 * “would run more than once per day”；本地契约门禁必须提前失败。
 */
export function isValidVercelHobbyCronSchedule(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minute, hour, day, month, week] = fields;

  // Hobby 每日一次限制要求 day/month/week 全通配，否则枚举、范围或星期选择
  // 会让“每天一次”漏跑；分/时也必须只产生一个确定时间。
  if (day !== "*" || month !== "*" || week !== "*") return false;
  return countCronRunsPerDay(expression) === 1;
}

/** 判断表达式在同一天是否会多次触发（供契约失败提示与测试共用）。 */
export function countCronRunsPerDay(expression: string): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return 0;
  const [minute, hour] = fields;

  const countFieldRuns = (field: string, min: number, max: number): number | null => {
    let total = 0;
    for (const part of field.split(",")) {
      const [rangeText, stepText] = part.split("/");
      const step = stepText === undefined ? 1 : Number(stepText);
      if (!Number.isInteger(step) || step < 1 || step > max) return null;

      let start: number;
      let end: number;
      if (rangeText === "*") {
        start = min;
        end = max;
      } else if (rangeText.includes("-")) {
        const [startText, endText] = rangeText.split("-");
        start = Number(startText);
        end = Number(endText);
      } else {
        start = Number(rangeText);
        end = Number(rangeText);
      }

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
        return null;
      }
      total += Math.floor((end - start) / step) + 1;
    }
    return total;
  };

  const minuteRuns = countFieldRuns(minute, 0, 59);
  const hourRuns = countFieldRuns(hour, 0, 23);
  return minuteRuns === null || hourRuns === null ? 0 : minuteRuns * hourRuns;
}

/**
 * 校验 5 字段 cron 表达式（分 时 日 月 周）。
 *
 * 只接受调度器都支持的最小子集：通配、枚举、步进与范围。故意不接受
 * `@hourly`、6 字段（带秒）或 `?`/`L` 之类的扩展——Vercel Cron 不支持它们，
 * 而「部署成功但永不触发」正是这里要拦住的失败模式。
 */
export function isValidCronSchedule(expression: string): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, index) => {
    const [min, max] = SCHEDULE_FIELD_RANGES[index];
    const parts = field.split(",");
    return parts.length > 0 && parts.every((part) => isValidFieldPart(part, min, max));
  });
}

/** 文本里长得像 5 字段 cron 的候选；前后边界避免把 `0 9 * * *,0 5 * * *` 这类串切碎。 */
const CRON_CANDIDATE = /(?:^|[^0-9*/,-])((?:[\d*,/\-]+\s+){4}[\d*,/\-]+)(?![0-9*/,-])/g;

/**
 * 从一段文本里抽出**合法**的 5 字段 cron 表达式（去重、排序）。
 *
 * 合法性过滤是这一步的全部意义：不过一遍 `isValidCronSchedule`，散文里任意四个空格分隔的
 * 数字串都会变成一条假「调度事实」。双语门禁（D02）与文档对仓库门禁（D01）共用这个抽取，
 * 两边看到的才是同一件事。
 */
export function extractCronExpressions(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(CRON_CANDIDATE)) {
    const expression = match[1].trim().replace(/\s+/g, " ");
    if (isValidCronSchedule(expression)) found.add(expression);
  }
  return [...found].sort();
}

/** 文本里提到的 cron 路由路径（去重排序）。 */
export function extractCronPaths(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/\/api\/cron\/[a-z0-9-]+/g)) found.add(match[0]);
  return [...found].sort();
}

/**
 * 「带日期的快照」：文件名里写死了版本或日期，记录的是**当时**的事实。
 * 它们允许引用已经废弃的调度（`docs-site/v0.8.0.md` 里那条每 15 分钟一次的旧表达式就是），
 * 否则门禁会逼人改写历史证据——那比文档漂移更糟。
 */
const DATED_SNAPSHOT = /(?:^|\/)(?:[a-z-]+-)?v\d+\.\d+(?:\.\d+)?\.md$/;
const DATED_DOCS = /^docs\/(?:progress\.md|roadmap-[^/]+\.md|operations\/drills\/)/;

/** 这篇文档是否归「文档 vs 仓库」门禁核对。 */
export function isCronDocAuditable(path: string): boolean {
  return !DATED_SNAPSHOT.test(path) && !DATED_DOCS.test(path);
}

/**
 * 文档里写的调度，必须是仓库里真的存在的调度（D01）。
 *
 * D02 管「中英两边说同一件事」，这里管「文档与代码说同一件事」：
 * `docs-site/web-push.md` 曾长期写着 `/api/cron/push-retry` 每 15 分钟一次，而 `vercel.json`
 * 早就改成每天一次；E03 那次则是文档写了一个根本没被调度的路由。两种情况在只比对中英对称时
 * 都是「两边一致」，因此门禁永远绿——必须由代码这边做权威。
 *
 * 故意**不**核对「路径 ↔ 表达式」的同行配对：那要求解析表格行或句子，会把散文式引用全误伤。
 * 所以「digest 写成 push-retry 的表达式」这类错不在本规则射程内，那一层由 worker 注册表与
 * 运维告警文档（`CRON_DOC_SCHEDULE_MISSING`）负责。
 */
export function auditCronDocs(
  docs: readonly CronDocSource[],
  workers: readonly CronWorkerContract[],
  platformCrons: readonly PlatformCron[],
  externalSchedules: readonly string[],
  issues: CronContractIssue[],
): number {
  if (docs.length === 0) {
    push(
      issues,
      "CRON_DOC_NO_SOURCES",
      CRON_DOC_DIRECTORY,
      "一篇文档都没收集到：文档目录或收集规则失效，不能把「读不到」当成「没有漂移」",
    );
    return 0;
  }

  const knownSchedules = new Set<string>([
    ...workers.map((worker) => worker.schedule),
    ...platformCrons.map((entry) => entry.schedule),
    ...externalSchedules,
  ]);
  const knownPaths = new Set<string>([
    ...workers.map((worker) => worker.path),
    ...platformCrons.map((entry) => entry.path),
  ]);

  let audited = 0;
  for (const doc of docs) {
    if (!isCronDocAuditable(doc.path)) continue;
    audited += 1;
    if (doc.content.trim().length === 0) {
      push(issues, "CRON_DOC_SOURCE_EMPTY", doc.path, "文档内容为空，无法核对调度事实");
      continue;
    }

    for (const expression of extractCronExpressions(doc.content)) {
      if (knownSchedules.has(expression)) continue;
      push(
        issues,
        "CRON_DOC_STALE_SCHEDULE",
        doc.path,
        `文档里的 cron 表达式 ${expression} 在仓库里不存在：worker 注册表、vercel.json 与 workflow schedule 都不是它`,
      );
    }

    for (const mentionedPath of extractCronPaths(doc.content)) {
      if (knownPaths.has(mentionedPath)) continue;
      push(
        issues,
        "CRON_DOC_UNREGISTERED_PATH",
        doc.path,
        `文档提到 ${mentionedPath}，但没有 worker 或 vercel.json 调度它（E03 就是这个形状：链路上线了却没人调度）`,
      );
    }
  }
  return audited;
}

/** 路由是否导出某个 HTTP 方法（`export function GET` / `export async function GET`）。 */
export function exportsMethod(source: string, method: CronMethod): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source);
}

function push(
  issues: CronContractIssue[],
  code: CronContractIssueCode,
  subject: string,
  message: string,
): void {
  issues.push({ code, subject, message });
}

/** 校验 registered worker 的表达式、平台调度条目与漂移。 */
function auditWorkerSchedule(
  worker: CronWorkerContract,
  platformCrons: readonly PlatformCron[],
  issues: CronContractIssue[],
): void {
  if (!isValidCronSchedule(worker.schedule)) {
    push(
      issues,
      "CRON_SCHEDULE_INVALID",
      worker.id,
      `注册表表达式 ${worker.schedule} 不是合法的 5 字段 cron`,
    );
  }

  const platformEntries = platformCrons.filter((entry) => entry.path === worker.path);
  if (platformEntries.length === 0) {
    push(
      issues,
      "CRON_SCHEDULE_MISSING",
      worker.id,
      `${worker.path} 未登记在 vercel.json 的 crons，部署后不会被调度`,
    );
  }
  if (platformEntries.length > 1) {
    push(
      issues,
      "CRON_SCHEDULE_DUPLICATE",
      worker.id,
      `${worker.path} 在 vercel.json 里出现 ${platformEntries.length} 次，触发频率会超出预期`,
    );
  }
  for (const entry of platformEntries) {
    if (!isValidCronSchedule(entry.schedule)) {
      push(
        issues,
        "CRON_SCHEDULE_INVALID",
        worker.id,
        `vercel.json 表达式 ${entry.schedule} 不是合法的 5 字段 cron`,
      );
      continue;
    }
    if (entry.schedule !== worker.schedule) {
      push(
        issues,
        "CRON_SCHEDULE_DRIFT",
        worker.id,
        `vercel.json 为 ${entry.schedule}，注册表为 ${worker.schedule}：调度频率漂移`,
      );
    }
    if (!isValidVercelHobbyCronSchedule(entry.schedule)) {
      push(
        issues,
        "CRON_SCHEDULE_PLATFORM_UNSUPPORTED",
        worker.id,
        `vercel.json 表达式 ${entry.schedule} 每天运行 ${countCronRunsPerDay(entry.schedule)} 次，超过 Vercel Hobby 每天一次的 Cron Jobs 限制`,
      );
    }
  }
}

/** 校验每轮指标、鉴权拒绝指标与运维文档登记。 */
function auditWorkerObservability(
  worker: CronWorkerContract,
  source: string,
  operationsDoc: string,
  metrics: Set<string>,
  issues: CronContractIssue[],
): void {
  for (const metric of worker.metrics) {
    metrics.add(metric);
    if (!source.includes(`recordMetric("${metric}"`)) {
      push(
        issues,
        "CRON_METRIC_MISSING",
        worker.id,
        `路由未上报 ${metric}，该 worker 的轮次在指标上不可见`,
      );
    }
    if (!operationsDoc.includes(metric)) {
      push(issues, "CRON_METRIC_UNDOCUMENTED", metric, `告警文档未登记指标 ${metric}`);
    }
  }

  if (!source.includes(`recordCronRejected("${worker.id}"`)) {
    push(
      issues,
      "CRON_REJECTION_UNOBSERVABLE",
      worker.id,
      `401 分支未上报 ${CRON_REJECTED_METRIC}，CRON_SECRET 漏配会完全静默`,
    );
  }

  if (!operationsDoc.includes(worker.path) || !operationsDoc.includes(worker.schedule)) {
    push(
      issues,
      "CRON_DOC_SCHEDULE_MISSING",
      worker.id,
      `告警文档未登记 ${worker.path} 与 ${worker.schedule}，运维无法核对调度契约`,
    );
  }
}

/** 校验 worker 路由里的条件跳过是否都留下计数证据（A04）。 */
function auditWorkerSkips(
  worker: CronWorkerContract,
  source: string,
  summary: { skipBranches: number },
  issues: CronContractIssue[],
): void {
  for (const metric of worker.skipMetrics) {
    if (!worker.metrics.includes(metric)) {
      push(
        issues,
        "CRON_SKIP_METRIC_UNDECLARED",
        worker.id,
        `${metric} 登记为跳过计数指标，却不在该 worker 的 metrics 里：它既不会被要求上报，也不会进告警文档`,
      );
    }
  }

  if (!source.trim()) return; // 文件缺失已由 CRON_ROUTE_MISSING 报告
  const result = auditCronSkips({
    source,
    fileName: worker.routeFile,
    skipMetrics: worker.skipMetrics,
  });
  if (!result) {
    push(
      issues,
      "CRON_SKIP_UNPARSEABLE",
      worker.id,
      `${worker.routeFile} 无法解析，跳过可见性未核对（按失败封闭处理）`,
    );
    return;
  }

  summary.skipBranches += result.total;
  for (const finding of result.uncounted) {
    push(
      issues,
      "CRON_SKIP_UNCOUNTED",
      worker.id,
      `${worker.routeFile}:${finding.line} 的条件跳过（${finding.condition}）没有任何计数证据：被跳过的条目在指标与看板上完全静默`,
    );
  }
  for (const finding of result.reasonMissing) {
    push(
      issues,
      "CRON_SKIP_REASON_MISSING",
      worker.id,
      `${worker.routeFile}:${finding.line} 的跳过计数没有 reason 维度：只知道「跳过了多少」无法排查是哪一个条件`,
    );
  }
}

/** 校验单个 worker 的路由、方法与调度/指标接线。 */
function auditWorker(
  worker: CronWorkerContract,
  input: CronContractInput,
  routeFiles: ReadonlySet<string>,
  metrics: Set<string>,
  summary: { skipBranches: number },
  issues: CronContractIssue[],
): void {
  if (!routeFiles.has(worker.routeFile)) {
    push(
      issues,
      "CRON_ROUTE_MISSING",
      worker.id,
      `注册表登记了 ${worker.routeFile}，但文件不存在（路由被删或路径写错）`,
    );
  }
  const source = input.sources[worker.routeFile] ?? "";

  for (const method of worker.methods) {
    if (!exportsMethod(source, method)) {
      push(issues, "CRON_METHOD_MISSING", worker.id, `路由未导出 ${method}，平台调用会得到 405`);
    }
  }

  auditWorkerSchedule(worker, input.platformCrons, issues);
  auditWorkerObservability(worker, source, input.operationsDoc, metrics, issues);
  auditWorkerSkips(worker, source, summary, issues);
}

/** 校验平台调度没有未注册也未豁免的路径。 */
function auditOrphanSchedules(
  platformCrons: readonly PlatformCron[],
  declaredPaths: ReadonlySet<string>,
  exempted: Readonly<Record<string, string>>,
  issues: CronContractIssue[],
): void {
  for (const entry of platformCrons) {
    if (declaredPaths.has(entry.path) || entry.path in exempted) continue;
    push(
      issues,
      "CRON_SCHEDULE_ORPHAN",
      entry.path,
      "vercel.json 调度了未注册且未豁免的路径：要么补注册表，要么删调度",
    );
  }
}

/** 校验豁免仍有理由且没有随调度删除而变成幽灵登记。 */
function auditExemptions(
  platformCrons: readonly PlatformCron[],
  exempted: Readonly<Record<string, string>>,
  issues: CronContractIssue[],
): void {
  for (const [path, reason] of Object.entries(exempted)) {
    if (!reason.trim()) {
      push(issues, "CRON_STALE_EXEMPTION", path, "豁免未写明理由，等同未登记");
      continue;
    }
    if (!platformCrons.some((entry) => entry.path === path)) {
      push(issues, "CRON_STALE_EXEMPTION", path, "豁免的调度已不在 vercel.json 中，请删除这条过期豁免");
    }
  }
}

/** 校验 cron 目录中的路由文件都进入注册表。 */
function auditUndeclaredRoutes(
  routeFiles: ReadonlySet<string>,
  declaredRouteFiles: ReadonlySet<string>,
  issues: CronContractIssue[],
): void {
  for (const routeFile of [...routeFiles].sort()) {
    if (!declaredRouteFiles.has(routeFile)) {
      push(
        issues,
        "CRON_ROUTE_UNDECLARED",
        routeFile,
        "cron 路由未登记在注册表，调度与指标契约不会被校验",
      );
    }
  }
}

/** 执行调度与指标契约审计；纯函数，不读文件系统。 */
export function auditCronContract(input: CronContractInput): CronContractReport {
  const workers = input.workers ?? CRON_WORKERS;
  const issues: CronContractIssue[] = [];
  const routeFiles = new Set(input.routeFiles);
  const declaredRouteFiles = new Set(workers.map((worker) => worker.routeFile));
  const declaredPaths = new Set(workers.map((worker) => worker.path));
  const metrics = new Set<string>([CRON_REJECTED_METRIC]);
  const summary = { skipBranches: 0 };

  if (workers.length === 0) {
    push(
      issues,
      "CRON_NO_WORKERS",
      CRON_ROUTE_DIRECTORY,
      "cron worker 注册表为空：要么路由被误删，要么 glob 写错，按失败封闭处理",
    );
  }
  if (!input.operationsDoc.includes(CRON_REJECTED_METRIC)) {
    push(
      issues,
      "CRON_METRIC_UNDOCUMENTED",
      CRON_REJECTED_METRIC,
      `告警文档未登记指标 ${CRON_REJECTED_METRIC}，鉴权告警规则会缺少依据`,
    );
  }

  for (const worker of [...workers].sort((left, right) => left.id.localeCompare(right.id))) {
    auditWorker(worker, input, routeFiles, metrics, summary, issues);
  }

  const exempted = input.excludedSchedules ?? CRON_SCHEDULE_EXEMPTIONS;
  auditOrphanSchedules(input.platformCrons, declaredPaths, exempted, issues);
  auditExemptions(input.platformCrons, exempted, issues);
  auditUndeclaredRoutes(routeFiles, declaredRouteFiles, issues);
  const docPages =
    input.docs === undefined
      ? 0
      : auditCronDocs(
          input.docs,
          workers,
          input.platformCrons,
          input.externalSchedules ?? [],
          issues,
        );

  return {
    issues,
    workers: workers.map((worker) => worker.id).sort(),
    metrics: [...metrics].sort(),
    scheduledPaths: input.platformCrons.map((entry) => entry.path).sort(),
    workerPaths: workers.map((worker) => worker.path).sort(),
    docPages,
    exemptedPaths: Object.keys(exempted)
      .filter((path) => input.platformCrons.some((entry) => entry.path === path))
      .sort(),
    skipBranches: summary.skipBranches,
  };
}

/** 渲染问题列表：每行一个规则码，便于 CI 日志里直接定位。 */
export function formatCronIssues(issues: readonly CronContractIssue[]): string {
  return issues.map((issue) => `  - [${issue.code}] ${issue.subject}: ${issue.message}`).join("\n");
}
