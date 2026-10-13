/**
 * 云端 SQL 执行探测的 IO 层（判定在 `src/lib/db/cloud-sql-probe.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/check-cloud-sql-probe.js [--json]
 *   node scripts/check-cloud-sql-probe.js --project-ref … --token … [--dry-run]
 *
 * 退出码：
 *   0  计划每一条都满足判据
 *   1  至少一步被明确拒绝（**这是答案，不是故障**——例如多语句确实撞上服务端限制）
 *   2  用法错误，或有任何一步「不知道」（缺凭据 / 网络失败 / 端点换形状 / 限流）
 *
 * ## 这个脚本**没有** `--sql` 选项，那是刻意的
 *
 * 一旦能传任意 SQL，「探测不会写库」就从代码性质退化成「调用的人今天没乱传」——
 * 而这条探测打的端点**确实能写**（`POST /v1/projects/{ref}/database/query`）。
 * 所以它只发 `PROBE_PLAN` 里那几条常量语句，发送前先过 `auditProbePlan()`：
 * 任何一条被判为可写，整份计划一条都不发。B04 的演练 SQL 会被守卫判为可写，
 * 因此**不可能**经由这个脚本被自动送到生产库——那是人工授权动作，另有一条命令。
 *
 * ## 为什么计划里有几条打「能写」的端点
 *
 * 因为要回答的正是那个端点的问题（issue #245：多语句限制在客户端还是服务端）。
 * 缓解措施是两层：请求带 `read_only: true`（**这一层本身也被探测核验**，见
 * `READ_ONLY_FLAG_ON` / `READ_ONLY_FLAG_OFF` 那一对），且每条语句本身都可证只读。
 * `--dry-run` 只打印计划与守卫结论、不发任何请求——**在没有凭据的机器上这就是默认行为**。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROBE_PLAN,
  auditProbePlan,
  classifyProbeResponse,
  probeExitCode,
  summarizeProbe,
} from "../../src/lib/db/cloud-sql-probe.ts";
import { resolveProjectRef } from "../../src/lib/supabase-project-ref.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_API_BASE = "https://api.supabase.com/v1";

/** 端点路径。两个都是 `database/query` 家族，差别只在只读端点跑在 `supabase_read_only_user` 下。 */
export function endpointPath(step) {
  return step.endpoint === "read-only"
    ? "/database/query/read-only"
    : "/database/query";
}

/** 请求体。`read_only: true` 只对写端点有意义，只读端点带上会被当成多余字段。 */
export function requestBody(step) {
  return step.readOnlyFlag ? { query: step.sql, read_only: true } : { query: step.sql };
}

/** 无值 flag：出现即为真。 */
const BOOLEAN_FLAGS = { "--help": "help", "-h": "help", "--json": "json", "--dry-run": "dryRun" };
/** 带值 flag：flag 名 → 写进哪个选项。 */
const VALUE_FLAGS = {
  "--project-ref": "projectRef",
  "--token": "token",
  "--api-base": "apiBase",
  "--timeout-ms": "timeoutMs",
};

function assignOption(options, flag, raw) {
  const option = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : null;
  if (option === null) return `未知参数：${flag}（本脚本不接受任意 SQL，只跑内置计划）`;
  if (raw === undefined) return `${flag} 需要一个值`;
  options[option] = option === "timeoutMs" ? Number(raw) : raw;
  return null;
}

export function parseArgs(argv, env = process.env) {
  const options = {
    projectRef: env.SUPABASE_PROJECT_REF || "",
    token: env.SUPABASE_ACCESS_TOKEN || "",
    apiBase: env.SUPABASE_API_BASE || DEFAULT_API_BASE,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
    json: false,
    dryRun: false,
    timeoutMs: 20_000,
    help: false,
  };
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const boolean = Object.hasOwn(BOOLEAN_FLAGS, token) ? BOOLEAN_FLAGS[token] : null;
    if (boolean !== null) {
      options[boolean] = true;
      continue;
    }
    const error = assignOption(options, token, args[(index += 1)]);
    if (error !== null) return { error };
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return { error: "--timeout-ms 需要一个正整数" };
  }
  return { options };
}

/**
 * 缺凭据时**默认走 dry-run**，而不是报错退出。
 *
 * 理由：这台机器上大概率没有 token（GitHub Actions 的 secret 不进本地 shell），
 * 而「把计划与守卫结论打印出来」本身就有价值——它让「探测会不会写库」这件事
 * 在没有凭据的机器上也可核对。真发请求需要显式给 token。
 */
export function resolveDryRun(options) {
  return options.dryRun || !options.token;
}

/** 发一步请求。返回 `ProbeResponse`；任何异常都收敛成 `transportError`。 */
export async function postProbeStep(step, options) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) {
    return { status: 0, json: null, bodyText: "", transportError: "解析不出 project ref" };
  }
  let url;
  try {
    url = new URL(
      `${String(options.apiBase).replace(/\/+$/, "")}/projects/${encodeURIComponent(ref)}${endpointPath(step)}`,
    );
  } catch {
    return { status: 0, json: null, bodyText: "", transportError: `API 地址无法解析：${options.apiBase}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  // 耗时是 MULTI_STATEMENT_FIRST_EFFECT 那条判据的**唯一**证据来源，
  // 所以它在 try 外面起表：传输层失败时我们宁可拿到一个偏大的数，
  // 也不要因为没测而把结论写成 UNKNOWN。
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody(step)),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    let json = null;
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = null;
    }
    return {
      status: response.status,
      json,
      bodyText,
      transportError: null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    // 绝不回显请求头：令牌不能进日志。
    return {
      status: 0,
      json: null,
      bodyText: "",
      transportError: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function printPlan(audit, plan) {
  // 条数从计划本身取，不写死：上一版把「四条」抄进文案，
  // 计划加到第六条后这些字全过期了——而它们正是读者判断「跑完了没有」的依据。
  console.log(
    audit.ok
      ? `✅ 守卫审计通过：${plan.length} 条语句全部可证只读`
      : "❌ 守卫审计不通过",
  );
  for (const rejection of audit.rejections) {
    console.log(`   ${rejection.id}: ${rejection.reasons.join("；")}`);
  }
  for (const step of plan) {
    console.log(`   · ${step.id} → POST …${endpointPath(step)}${step.readOnlyFlag ? " (read_only=true)" : ""}`);
    console.log(`     ${step.sql}`);
  }
}

/**
 * 每一步的标记。
 *
 * `CONTRADICTED` **刻意不打 ❌**：生产实测（run `38442279610`）当时打的是
 * `❌ [PG_CRON_INSTALLED] REJECTED_SQL (HTTP 201)`，而那一行的事实是
 * 「**问到了答案，答案是不利的那一个**」。`❌` 配 `HTTP 201` 自相矛盾，
 * 会被读成「探测坏了」——于是人去查脚本而不是去查 pg_cron，
 * 本轮我自己就是这么绕了一圈才读到结论的。
 *
 * 它也不是 ✅：`❗` 的意思是「结论成立，但方向是坏的」。
 */
function markOf(outcome) {
  if (outcome === "EXECUTED") return "✅";
  if (outcome === "UNKNOWN" || outcome === "RATE_LIMITED") return "⚠️";
  if (outcome === "CONTRADICTED") return "❗";
  return "❌";
}

function printVerdicts(report) {
  for (const verdict of report.verdicts) {
    console.log(
      `${markOf(verdict.outcome)} [${verdict.id}] ${verdict.outcome} (HTTP ${verdict.status}) ${verdict.evidence}`,
    );
  }
  console.log(
    `结论：read_only 字段=${report.readOnlyFlagEffective ? "确实生效" : report.readOnlyFlagIneffective ? "装饰性的（服务端未进入只读）" : "未证实"} / ` +
      `只读端点=${report.readOnlyEndpointWorks ? "可执行" : "未证实"} / ` +
      `写端点(read_only)=${report.writeEndpointWorks ? "可执行" : "未证实"} / ` +
      `多语句=${report.multiStatementWorks ? "可" : report.multiStatementBlocked ? "服务端限制" : "未证实"} / ` +
      `单条 DO 块=${report.singleDoBlockWorks ? "可" : "未证实"} / ` +
      `多语句前序已执行=${report.multiStatementFullyExecutes ? "是" : report.multiStatementSkipsEarlier ? "否（静默跳过）" : "未证实"}`,
  );
  // pg_cron 单独一行：混在那串斜杠分隔的「端点能力」清单里会被读成又一个能力，
  // 而它说的是调度器。**措辞刻意不写「保留期一行都不删」**——
  // `docs/db/retention.md` 写明主执行者是 `/api/cron/retention`，
  // pg_cron 只是迁移里那组周调度的第二个可选调度器，没装不等于保留期失效。
  console.log(
    `pg_cron（保留期调度）：${
      report.pgCronInstalled
        ? "✅ 已安装 ⇒ 迁移里那组周调度会注册并执行（与平台 worker 幂等共存）"
        : report.pgCronMissing
          ? "❗ **未安装** ⇒ 迁移里那组周调度从未注册；保留期仍由 /api/cron/retention 执行，" +
            "**这不等于保留期失效**（要判那条看 cron.retention.completed）"
          : "⚠️ 未证实（没测到 ≠ 没装，也 ≠ 装了）"
    }`,
  );
}

/**
 * 跑一次并打印，返回退出码。
 *
 * `plan` 只为**可测**而存在（默认 `PROBE_PLAN`）：守卫那条分支如果不注入就永远走不到，
 * 而它恰恰是「将来有人往计划里加了一条会写的语句」时唯一会拦住他的东西。
 * 注入点只在代码层——CLI 没有 `--sql`，所以「这个脚本不能被指到任意 SQL」依然成立。
 */
export async function runCloudSqlProbe(options, plan = PROBE_PLAN) {
  const audit = auditProbePlan(plan);
  if (!audit.ok) {
    printPlan(audit, plan);
    console.error("❌ 计划里有语句被判为可写 ⇒ 一条都不发。这是失败封闭，不是故障。");
    return 2;
  }
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          guard: audit,
          plan: plan.map((entry) => ({ id: entry.id, sql: entry.sql, endpoint: entry.endpoint })),
        },
        null,
        2,
      ),
    );
  } else {
    printPlan(audit, plan);
  }

  if (resolveDryRun(options)) {
    console.log("⚠️ dry-run：没有 SUPABASE_ACCESS_TOKEN 或显式 --dry-run ⇒ 未发出任何请求。");
    console.log("   守卫结论已在上面给出；要拿云端实况，在有令牌的机器上跑（CI 里有）。");
    return 2;
  }

  const verdicts = [];
  for (const step of plan) {
    const response = await postProbeStep(step, options);
    const verdict = classifyProbeResponse(step, response);
    verdicts.push(verdict);
    // 一旦确认端点不可用（401/403），后面的步骤只会重复同一个答案，
    // 而且会多打三次生产 API —— 少打是好事，但**不因此把未知改成已知**。
    if (verdict.outcome === "REFUSED_AUTH") {
      verdicts.push(
        ...plan.slice(verdicts.length).map((skipped) => ({
          id: skipped.id,
          outcome: "UNKNOWN",
          status: verdict.status,
          evidence: "未发送：前序步骤已被鉴权拒绝",
        })),
      );
      break;
    }
  }
  const report = summarizeProbe(verdicts);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printVerdicts(report);
  return probeExitCode(report);
}

const HELP = [
  "用法：node scripts/check-cloud-sql-probe.js [选项]",
  "",
  "  --project-ref <ref>   Supabase 项目 ref（默认 SUPABASE_PROJECT_REF，其次从 URL 推断）",
  "  --token <sbp_…>       Management API 令牌（默认 SUPABASE_ACCESS_TOKEN；不会打印）",
  "  --api-base <url>      Management API 根地址（默认 https://api.supabase.com/v1）",
  "  --dry-run             只打印计划与守卫结论，不发请求（缺令牌时自动如此）",
  "  --json                机器可读输出",
  "  --timeout-ms <n>      单步超时（默认 20000）",
  "",
  "只跑内置的常量语句计划，**不接受任意 SQL**：这个端点能写，所以「不会写库」必须是代码性质。",
  "退出码：0 每条都满足判据 / 1 有步骤被明确拒绝（那是答案）/ 2 有任一步不知道（未知不算通过）",
].join("\n");

/** 解析参数、跑探测并返回退出码。 */
export async function runCli(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(HELP);
    return 2;
  }
  if (parsed.options.help) {
    console.log(HELP);
    return 0;
  }
  return runCloudSqlProbe(parsed.options);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
