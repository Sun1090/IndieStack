/**
 * digest worker「端到端跑通」判定的纯函数层。
 *
 * 起因（2026-10-24 台账）：405 修复（#236，部署 `c165e2c2`）合并后，
 * 「worker 真的在生产执行了」的最后一格证据要等部署后第一轮 UTC 09:00 调度落表。
 * 判据当时是口头描述（「`email_worker_runs` 非零行 + `cron.digest.completed`」），
 * 按本仓库惯例，一次性读出的结论必须附**可复跑命令**——本模块把它固化。
 *
 * 为什么判据只看 `email_worker_runs`，不重放队列谓词：
 *   - 表里的 `backlog` 列（迁移 035）**就是 worker 自己记下的取数读数**，
 *     「还堵着吗」的答案以 worker 自己的口径为准；脚本重放
 *     `countUnsentEmailNotifications` 的谓词等于把 repository 逻辑抄第二份，
 *     必然漂移。跨轮序列本身就是趋势。
 *   - `cron.digest.completed` 走 stdout/Sentry 指标，库里不可查；落表行是持久侧。
 *
 * 形状与 `cloud-sql-probe.ts` 同源：EXECUTED 不等于好结论（COMPLETED_FAILING 是
 * 跑通了但队列在失败侧），所以 verdict 分档，由 IO 层映射退出码。
 */

export interface WorkerRunRow {
  created_at: string;
  pulled: number | null;
  sent: number | null;
  failed: number | null;
  backlog: number | null;
  skipped: number | null;
}

export type DigestObservationVerdict =
  /** 现在早于「部署后第一轮应发生的时刻」——读数窗口还没开，不判任何东西。 */
  | "TOO_EARLY"
  | "NOT_TRIGGERED"
  | "COMPLETED_OK"
  | "COMPLETED_BACKLOG"
  | "COMPLETED_FAILING";

export interface DigestObservationReport {
  verdict: DigestObservationVerdict;
  /** 参与判定的行（created_at >= since，按时间升序）。 */
  rows: WorkerRunRow[];
  evidence: string;
}

function field(row: WorkerRunRow, key: keyof WorkerRunRow): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

/** 把一行裁成 WorkerRunRow；created_at 之外的计数缺失按 null（未知），不当 0。 */
export function toWorkerRunRow(raw: unknown): WorkerRunRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.created_at !== "string") return null;
  const numbers = ["pulled", "sent", "failed", "backlog", "skipped"] as const;
  const row: WorkerRunRow = { created_at: value.created_at, pulled: null, sent: null, failed: null, backlog: null, skipped: null };
  for (const key of numbers) {
    row[key] = typeof value[key] === "number" ? value[key] : null;
  }
  return row;
}

/** 读通道：service_role 直读 PostgREST / Management API 只读 SQL / 两者都不具备。 */
export type DigestReadChannel = "rest" | "management-api" | "unavailable";

/**
 * 选读通道——**次序不是偏好，是「本机到底有哪个凭据」**。
 *
 * 起因（2026-10-25 实测）：探测原先只认 Management API 的 `sbp_` 令牌，
 * 而本机 `.env.local` 有 `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 * （同一天 `ops:schema-drift` 就是靠这两个读通了同一个库）、**没有** `sbp_` 令牌。
 * 于是「唯一在途的证据任务」被一个它并不需要的凭据挡住，探测报「缺令牌」时
 * 看起来像「这台机器查不了」——本仓库已为这类误读付过四次学费。
 *
 * 两条通道返回的行形状相同（`created_at` + 五个计数列），判定层不分支，
 * 所以「用哪条」是 IO 细节，不是结论的一部分。
 */
export function pickReadChannel(creds: {
  supabaseUrl: string;
  serviceRoleKey: string;
  accessToken: string;
}): DigestReadChannel {
  if (creds.supabaseUrl.trim().length > 0 && creds.serviceRoleKey.trim().length > 0) return "rest";
  if (creds.accessToken.trim().length > 0) return "management-api";
  return "unavailable";
}

function describeRow(row: WorkerRunRow): string {
  const at = row.created_at.replace("T", " ").slice(0, 16);
  return `${at} pulled=${row.pulled ?? "?"} sent=${row.sent ?? "?"} failed=${row.failed ?? "?"} backlog=${row.backlog ?? "?"} skipped=${row.skipped ?? "?"}`;
}

/**
 * 判定：给「部署时刻起」与「第一轮应发生的时刻（UTC 09:00 调度）」，
 * 从 worker 运行表读出结论。
 *
 * 关键守卫是 **TOO_EARLY**：调度是每日 09:00 UTC，如果在 09:00 之前来查，
 * 「没有行」是预期内的，绝不能读成「没进函数（405 同型）」。
 * 把「还没到时候」和「坏了」分开，与「未知不算通过」是同一族判据。
 */
export function judgeDigestObservation(input: {
  rows: readonly WorkerRunRow[];
  sinceIso: string;
  firstExpectedIso: string;
  nowIso: string;
}): DigestObservationReport {
  const since = Date.parse(input.sinceIso);
  const firstExpected = Date.parse(input.firstExpectedIso);
  const now = Date.parse(input.nowIso);
  if (Number.isNaN(since) || Number.isNaN(firstExpected) || Number.isNaN(now)) {
    return { verdict: "TOO_EARLY", rows: [], evidence: "时间参数解析失败——不基于读不出的时间下结论" };
  }
  if (now < firstExpected) {
    return {
      verdict: "TOO_EARLY",
      rows: [],
      evidence: `第一轮应在 ${input.firstExpectedIso.slice(0, 16)}Z 之后，现在 ${input.nowIso.slice(0, 16)}Z——读数窗口还没开`,
    };
  }
  const scoped = input.rows
    .filter((row) => Date.parse(row.created_at) >= since)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  if (scoped.length === 0) {
    return {
      verdict: "NOT_TRIGGERED",
      rows: [],
      evidence: `部署（${input.sinceIso.slice(0, 16)}Z）以来 email_worker_runs 没有任何新行——worker 未落表（405 同型或落表侧坏了）`,
    };
  }
  const latest = scoped[scoped.length - 1];
  const failed = field(latest, "failed") ?? 0;
  const sent = field(latest, "sent") ?? 0;
  const backlog = field(latest, "backlog");
  const lines = scoped.map(describeRow).join(" | ");
  if (failed > 0) {
    return {
      verdict: "COMPLETED_FAILING",
      rows: scoped,
      evidence: `最新轮 failed=${failed}>0（跑通了，但发送侧在失败）：${lines}`,
    };
  }
  if (sent > 0) {
    return {
      verdict: "COMPLETED_OK",
      rows: scoped,
      evidence: `最新轮 sent=${sent}>0，failed=0——端到端跑通且发送成功：${lines}`,
    };
  }
  if (backlog !== null && backlog > 0) {
    return {
      verdict: "COMPLETED_BACKLOG",
      rows: scoped,
      evidence: `最新轮 backlog=${backlog}>0 且本轮 0 发送——跑通了但队列仍堵着，看下一轮趋势：${lines}`,
    };
  }
  return {
    verdict: "COMPLETED_OK",
    rows: scoped,
    evidence: `最新轮无失败、无发送、backlog=${backlog ?? "null"}——跑通了（空轮或已清空）：${lines}`,
  };
}
