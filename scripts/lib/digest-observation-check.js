/**
 * digest worker 端到端读数的 IO 层（判定在 `src/lib/db/digest-observation.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/digest-observation.js
 *   node scripts/digest-observation.js --since 2026-10-24T10:42:42Z [--first-expected <ISO>]
 *
 * 默认 since = 405 修复的生产部署时刻（`c165e2c2`，2026-10-24T10:42:42Z，
 * 由 ops:deploy-ledger 实测），first-expected = 其后第一个 09:00 UTC 调度。
 * 那两个参数是「证据的时间锚」，换一次部署就要换——所以它们是可覆盖的 flag，
 * 而不是焊死在源码里的常量。
 *
 * 通道：Management API 的 `POST /v1/projects/{ref}/database/query/read-only`
 * （与 ops:cloud-sql-probe 同一族，跑在 `supabase_read_only_user` 下）。
 * 只读一条 SELECT，不写任何东西。
 *
 * 退出码：0 跑通（COMPLETED_*，含失败侧的读数）/ 1 未落表（坏结论）/
 * 2 还没到时候或读不到实况（**未知不算通过，也不算坏**）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeDigestObservation, toWorkerRunRow } from "../../src/lib/db/digest-observation.ts";
import { readEnvSources } from "./env-sources.js";
import { resolveProjectRef } from "../../src/lib/supabase-project-ref.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API_BASE = "https://api.supabase.com/v1";
const DEPLOY_405_FIX_ISO = "2026-10-24T10:42:42Z";
/** digest 的调度时刻（`vercel.json`）：每日 09:00 UTC。 */
const DIGEST_UTC_HOUR = 9;

/** flag 名 → 写进哪个选项。本探测只需四个 flag，不需要 cloud-sql-probe 那套表驱动。 */
const VALUE_FLAGS = {
  "--since": "since",
  "--first-expected": "firstExpected",
  "--project-ref": "projectRef",
  "--token": "token",
};

/** 单个 flag 的应用逻辑。拆出来是因为 parseArgs 的分支复杂度贴着 ESLint 上限。 */
function applyFlag(options, flag, raw) {
  if (flag === "--help" || flag === "-h") {
    options.help = true;
    return null;
  }
  const key = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : null;
  if (key === null) return `未知参数：${flag}`;
  if (raw === undefined) return `${flag} 需要一个值`;
  options[key] = raw;
  return null;
}

export function parseArgs(argv, env = process.env) {
  const options = {
    since: env.DIGEST_OBSERVATION_SINCE || DEPLOY_405_FIX_ISO,
    firstExpected: "",
    projectRef: env.SUPABASE_PROJECT_REF || "",
    token: env.SUPABASE_ACCESS_TOKEN || "",
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "",
    timeoutMs: 20_000,
    help: false,
  };
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const error = applyFlag(options, args[index], args[(index += 1)]);
    if (error !== null) return { error };
  }
  if (Number.isNaN(Date.parse(options.since))) return { error: `--since 不是合法时间：${options.since}` };
  if (options.firstExpected && Number.isNaN(Date.parse(options.firstExpected))) {
    return { error: `--first-expected 不是合法时间：${options.firstExpected}` };
  }
  return { options };
}

/** since 之后的第一个 09:00 UTC。纯算术，不引库：这是调度语义，不是日历猜测。 */
export function nextDigestUtcIso(sinceIso) {
  const since = new Date(sinceIso);
  const candidate = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate(), DIGEST_UTC_HOUR));
  if (candidate.getTime() <= since.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.toISOString();
}

export function observationSql(sinceIso) {
  const safe = String(sinceIso).replaceAll("'", "''");
  return (
    "select created_at, pulled, sent, failed, backlog, skipped from public.email_worker_runs " +
    `where created_at >= '${safe}'::timestamptz order by created_at desc limit 20;`
  );
}

/** 经只读端点跑一条 SELECT。响应形状不认识 ⇒ 返回 error（未知），不返回空数组。 */
export async function queryReadOnly(options, sql) {
  const ref = resolveProjectRef(options.projectRef, options.supabaseUrl);
  if (!ref) return { error: "解析不出 project ref（SUPABASE_PROJECT_REF 或 --project-ref）" };
  if (!options.token) return { error: "缺少 SUPABASE_ACCESS_TOKEN（Management API 令牌）" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(ref)}/database/query/read-only`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: sql }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { error: `HTTP ${response.status} ${response.statusText} ${text.slice(0, 200)}` };
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { error: `响应不是 JSON：${text.slice(0, 160)}` };
    }
    if (!Array.isArray(payload)) return { error: `响应形状不认识（不是数组）：${text.slice(0, 160)}` };
    return { rows: payload.map(toWorkerRunRow).filter((row) => row !== null) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const MARKS = {
  TOO_EARLY: "⏳",
  NOT_TRIGGERED: "❌",
  COMPLETED_OK: "✅",
  COMPLETED_BACKLOG: "❗",
  COMPLETED_FAILING: "❗",
};

/** verdict → 退出码。跑通即 0（哪怕读数是失败侧——那是另一个问题，不是这条判据的红）。 */
export function exitCodeFor(verdict) {
  if (verdict === "TOO_EARLY") return 2;
  return verdict === "NOT_TRIGGERED" ? 1 : 0;
}

export async function runDigestObservation(options) {
  const since = options.since;
  const firstExpected = options.firstExpected || nextDigestUtcIso(since);
  const queried = await queryReadOnly(options, observationSql(since));
  if (queried.error) {
    console.error(`❌ 读不到 email_worker_runs：${queried.error}（未知不算通过，也不算坏）`);
    return 2;
  }
  const report = judgeDigestObservation({
    rows: queried.rows,
    sinceIso: since,
    firstExpectedIso: firstExpected,
    nowIso: new Date().toISOString(),
  });
  console.log(`${MARKS[report.verdict]} [${report.verdict}] ${report.evidence}`);
  console.log(`（锚点：since=${since} 第一轮应发生=${firstExpected}）`);
  return exitCodeFor(report.verdict);
}

const HELP = [
  "用法：node scripts/digest-observation.js [选项]",
  "",
  "  --since <ISO>          时间锚：部署时刻（默认 405 修复的部署 2026-10-24T10:42:42Z）",
  "  --first-expected <ISO> 第一轮调度应发生的时刻（默认取 since 之后第一个 09:00 UTC）",
  "  --project-ref <ref>    Supabase 项目 ref（默认 SUPABASE_PROJECT_REF）",
  "  --token <sbp_…>        Management API 令牌（默认 SUPABASE_ACCESS_TOKEN；不会打印）",
  "",
  "只读：经 POST /v1/projects/{ref}/database/query/read-only 跑一条 SELECT。",
  "退出码：0 跑通（含失败侧读数）/ 1 未落表 / 2 还没到时候或读不到实况",
].join("\n");

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const parsed = parseArgs(process.argv.slice(2), readEnvSources(REPO_ROOT));
  if (parsed.error) {
    console.error(`❌ ${parsed.error}`);
    console.error(HELP);
    process.exit(2);
  }
  if (parsed.options.help) {
    console.log(HELP);
    process.exit(0);
  }
  runDigestObservation(parsed.options).then((code) => process.exit(code));
}
