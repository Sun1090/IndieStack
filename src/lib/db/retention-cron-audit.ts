/**
 * 保留期调度是否真的会跑——以及「不会跑」这件事有没有被说出来。
 *
 * ## 为什么要有这一条
 *
 * 保留期清理的调度写法是守卫式的：`cron.schedule(...)` 被包在
 * `if exists (select 1 from pg_extension where extname = 'pg_cron')` 里
 * （见 `010` / `014` / `027` / `032` 共 4 个迁移、7 处调用、6 个任务）。
 * 这个写法对「本地 / 最小化环境」是对的——不能因为没装扩展就让迁移失败。
 *
 * **但它的失败形态是静默的**：迁移 applied、`pnpm check:migrations` 绿、
 * `/api/health` 返回 `ready=true`、所有周清理函数都存在——
 * **而一行都不会被删**。
 *
 * **2026-10-06 实测（本地栈，`docker exec supabase_db_indiestack psql`）**：
 * - `pg_extension` 里 `pg_cron` 行数 = **0**；
 * - `cron.job` 这张关系**根本不存在**（所以查它直接报 relation does not exist）；
 * - 而 6 个保留期函数全部存在：`cleanup_old_api_usage`、`cleanup_old_email_worker_runs`、
 *   `cleanup_old_notifications`、`cleanup_old_webhook_events`、
 *   `cleanup_resolved_contact_messages`、`prune_deleted_upload_objects`。
 *
 * 也就是说：**函数在、调度不在、门禁全绿、数据不删**。没有任何一个既有门禁会发现这件事。
 *
 * ## 这条检查判定什么
 *
 * 判定**声明与实现是否一致**，而不是替你去装扩展：
 *
 * - 任何 `cron.schedule` 若**不在** pg_cron 守卫里 → 迁移会在没装扩展的环境上失败 → 红；
 * - 任何带 `cron.schedule` 的迁移若**没有在旁边**写明「未安装时静默跳过」→
 *   下一个读代码的人无从判断这是有意还是漏了 → 红；
 * - 全部调度都在守卫里且都有说明 → 绿，并**明确打印这个前提**，
 *   让「保留期依赖 pg_cron」不再只活在文档里。
 *
 * **刻意不判定「pg_cron 到底装没装」**：那需要真 Postgres 连接，
 * 本机没有 DB 密码（见 `docs/operations/environments.md`），而这正是 B04 的阻塞。
 * 这条检查只保证**代码把话说清楚了**；装没装由 `scripts/check-retention-cron.js --probe` 去问真库。
 */

/** 从迁移 SQL 里抽出 `cron.schedule('<任务名>', ...)` 的任务名与所在文件。 */
export interface ScheduledJob {
  /** 任务名（`cron.schedule` 的第一个参数）。 */
  name: string;
  /** 出处文件（相对仓库根）。 */
  file: string;
  /** 该调用是否被 pg_cron 守卫包住。 */
  guarded: boolean;
  /** 守卫所在迁移里是否写明了「未安装即跳过」。 */
  documented: boolean;
}

export interface RetentionCronReport {
  ok: boolean;
  // 这三态跟着入参的 readonly 属性走：`auditRetentionCron(jobs: readonly ScheduledJob[])`
  // 声明了只读入参，返回值却是可变数组，type-check 会判 TS4104。
  // 报告本身不需要被调用方改，所以这里也用 readonly——**签名与数据结构一致**
  // 比在返回处强行拷贝一份可变数组要好。
  jobs: readonly ScheduledJob[];
  /** 未被守卫包住的调度（会在没装 pg_cron 的环境上让迁移失败）。 */
  unguarded: readonly ScheduledJob[];
  /** 被守卫但没写说明的（下一个读代码的人无从判断是有意还是漏了）。 */
  undocumented: readonly ScheduledJob[];
  errors: { code: RetentionCronCode; message: string }[];
}

export type RetentionCronCode =
  | "RETENTION_JOB_UNGUARDED"
  | "RETENTION_JOB_UNDOCUMENTED"
  | "NO_RETENTION_JOBS";

/** 「未安装时跳过」的说明措辞不唯一，这里只认「跳过 / 守卫 / 未安装」这几个实义词。 */
const DOCUMENTATION_MARKERS = ["跳过", "守卫", "未安装", "not installed", "skip"];

/**
 * 判断一次 `cron.schedule` 调用是否被 pg_cron 守卫包住。
 *
 * 做法是从调用位置**往上找同一个 `do` 块内**最近的 pg_cron 守卫。
 *
 * **这里踩过一个坑，值得记下来**：最初只从调用位置往上找最近的 `pg_cron` 字样，
 * 于是同一份文件里**前一个 `do` 块的守卫会把后一个裸调用也判成「被守卫」**——
 * 也就是说，只要文件里**有一处**守卫，这个文件里**所有**调度都会被判合规。
 * 那样这条检查在真实的多块迁移上就是半失效的（真实迁移 `027` 正是 `do $do$ ... end $do$` 结构）。
 *
 * 所以现在按 `do ... end do` 切块，守卫**必须与调用同块**。
 *
 * **保守取向**：找不到就算未守卫（红），而不是「大概被包住了」（绿）——
 * 这条检查的价值全在「不放过」，宁可误报。
 */
export function isGuarded(sqlBeforeCall: string): boolean {
  const guardIndex = sqlBeforeCall.lastIndexOf("pg_cron");
  if (guardIndex === -1) return false;
  // 守卫必须在调用所在的那个 `do` 块内：调用之前若出现过块结束，说明守卫属于上一个块。
  const blockStart = Math.max(sqlBeforeCall.lastIndexOf("do $"), sqlBeforeCall.lastIndexOf("DO $"));
  if (blockStart > guardIndex) return false;
  // 守卫必须是 `if exists (...)`：只出现一个 `pg_cron` 字样（例如注释里提到）
  // 不足以说明调度被条件包住。
  const guardWindow = sqlBeforeCall.slice(blockStart, guardIndex);
  return /if\s+exists\s*\([^)]*pg_extension/i.test(guardWindow);
}

/**
 * 该迁移是否写明了「未安装即跳过」。
 *
 * **扫前 `HEADER_LINES` 行**而不是固定字符数：`032` 的说明写在第 33–34 行，
 * 第一版用 `slice(0, 1200)` 没覆盖到，于是把一份**确实写了说明**的迁移
 * 报成「未写明」。**按行数而不是按字节**是因为注释密度差异很大，
 * 按字节判定会在「注释很长的迁移」上出系统性偏差。
 */
const HEADER_LINES = 60;

export function documentsSkip(sql: string): boolean {
  const header = sql.split("\n").slice(0, HEADER_LINES).join("\n");
  return DOCUMENTATION_MARKERS.some((marker) => header.includes(marker));
}

const SCHEDULE_CALL = /cron\.schedule\(\s*'([a-z0-9_-]+)'/gi;

/**
 * 剥掉行注释（`--` 到行尾），**保留行数**（用空格替换，保证后续下标与原文对齐）。
 *
 * **为什么必须剥**：`010_webhook_events.sql` 里有一段
 * `-- select cron.schedule('cleanup-webhook-events', ...)`——
 * 那是**给 Supabase Dashboard 的建议片段，注释掉的**，不是会执行的活代码。
 * 第一版扫描没剥注释，于是把它当成一条未守卫的真调度报了出来——
 * **一个会误报的检查，迟早被人加白名单关掉，那比没有检查更糟。**
 *
 * 保留字符位置是有意的：`isGuarded` 需要看调用**之前**的原文上下文，
 * 若直接删掉整段注释，后面的下标就全错位了。
 */
export function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx) + " ".repeat(line.length - idx);
    })
    .join("\n");
}

/** 从一份迁移 SQL 里抽出全部调度（**只看活代码，不看注释**）。 */
export function extractJobs(file: string, sql: string): ScheduledJob[] {
  const code = stripLineComments(sql);
  const jobs: ScheduledJob[] = [];
  for (const match of code.matchAll(SCHEDULE_CALL)) {
    const name = match[1];
    const before = code.slice(0, match.index ?? 0);
    jobs.push({
      name,
      file,
      guarded: isGuarded(before),
      // 文档判定看**原文**（注释里才有说明），且扫整份文件的头部说明区
      documented: documentsSkip(sql),
    });
  }
  return jobs;
}

/** 汇总判定。 */
export function auditRetentionCron(jobs: readonly ScheduledJob[]): RetentionCronReport {
  const unguarded = jobs.filter((job) => !job.guarded);
  const undocumented = jobs.filter((job) => job.guarded && !job.documented);
  const errors: RetentionCronReport["errors"] = [];

  for (const job of unguarded) {
    errors.push({
      code: "RETENTION_JOB_UNGUARDED",
      message:
        `${job.file} 的 cron.schedule('${job.name}') 没有被 pg_cron 守卫包住：` +
        "在没有安装 pg_cron 的环境上，这条迁移会直接失败。",
    });
  }
  for (const job of undocumented) {
    errors.push({
      code: "RETENTION_JOB_UNDOCUMENTED",
      message:
        `${job.file} 的 cron.schedule('${job.name}') 被守卫包住了，但该迁移头部没有写明` +
        "「未安装 pg_cron 时会静默跳过」——下一个读代码的人无从判断这是有意还是漏了。",
    });
  }
  if (jobs.length === 0) {
    errors.push({
      code: "NO_RETENTION_JOBS",
      message:
        "一条 cron.schedule 都没扫到。这几乎不可能是真的——要么迁移被改写了，" +
        "要么扫描规则与实际写法脱节。**一个扫不到东西的检查等于没有检查。**",
    });
  }

  return {
    ok: errors.length === 0,
    jobs,
    unguarded,
    undocumented,
    errors,
  };
}