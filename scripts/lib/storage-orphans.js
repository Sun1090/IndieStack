/**
 * 存储孤儿巡检 CLI 的实现（A10 收尾）。
 *
 * 规则本体在 `src/lib/uploads/orphan-audit.ts`（纯函数，由 vitest 覆盖）；
 * 这里只负责参数、一次只读 RPC 调用和输出生成。**不写任何东西**：
 * 补删必须由人确认过清单之后再走应用侧删除，不能让巡检顺手删数据。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORPHAN_AUDIT_RPC,
  ORPHAN_EXIT_CODES,
  decideOrphanExitCode,
  formatOrphanReport,
  parseOrphanRows,
  summarizeOrphans,
} from "../../src/lib/uploads/orphan-audit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const USAGE = [
  "用法：pnpm audit:storage-orphans [-- --url <supabase-url> --service-role-key <key>]",
  "",
  "  --url                 Supabase 项目 URL（默认取 SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL）",
  "  --service-role-key    service_role JWT（默认取 SUPABASE_SERVICE_ROLE_KEY；不会打印）",
  "  --json                输出 JSON 而不是文本报告",
  "  --output <file>       把报告写入文件，便于归档发布证据",
  "  --max-rows <n>        文本报告最多列出多少条明细（默认 50）",
  "  --timeout-ms <n>      单次请求超时（默认 15000）",
  "  --fail-on-findings    发现孤儿时以退出码 2 结束（CI 里可用，但 CI 没有 service-role 凭据）",
  "  --help                显示本帮助",
  "",
  "只读巡检：调用 find_orphan_upload_objects()，不删除任何对象。",
  "注意清单只覆盖落过 upload_objects 元数据的对象；031 之前的存量需 provider 侧 list() 差集。",
].join("\n");

const FLAG_KEYS = new Map([
  ["--url", "url"],
  ["--service-role-key", "serviceRoleKey"],
  ["--output", "output"],
  ["--max-rows", "maxRows"],
  ["--timeout-ms", "timeoutMs"],
]);

/** 数值型 flag 必须落在正整数上。 */
function readPositiveInt(token, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${token} 需要正整数`);
  return parsed;
}

/** 应用单个带值的 flag；未知 flag 或缺值都直接抛错。 */
function applyFlag(options, token, value) {
  const key = FLAG_KEYS.get(token);
  if (!key) throw new Error(`未知参数：${token}`);
  if (!value || value.startsWith("--")) throw new Error(`${token} 需要一个值`);
  if (key === "maxRows" || key === "timeoutMs") {
    options[key] = readPositiveInt(token, value);
    return;
  }
  options[key] = value;
}

/**
 * 解析命令行参数；未知 flag、缺值、非数字都直接报错。
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 */
export function parseArgs(argv, env = process.env) {
  // pnpm 会把 `--` 分隔符原样转发过来（与 check-health / production-smoke 同一处理）
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    json: false,
    output: "",
    maxRows: 50,
    timeoutMs: 15_000,
    failOnFindings: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--json") {
      options.json = true;
      continue;
    }
    if (token === "--fail-on-findings") {
      options.failOnFindings = true;
      continue;
    }
    applyFlag(options, token, args[index + 1]);
    index += 1;
  }
  return options;
}

/** 校验并拼出 RPC 端点；只接受 http/https，避免把凭据发去意外协议。 */
export function orphanRpcEndpoint(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`--url 不是合法地址：${rawUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`--url 只接受 http/https，得到 ${url.protocol}`);
  }
  if (url.search || url.hash) throw new Error("--url 不能带查询串或片段");
  const base = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol}//${url.host}${base}/rest/v1/rpc/${ORPHAN_AUDIT_RPC}`;
}

/** 调用一次 RPC，返回已解析的行。 */
export async function fetchOrphanRows(options, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(orphanRpcEndpoint(options.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: options.serviceRoleKey,
        Authorization: `Bearer ${options.serviceRoleKey}`,
        "cache-control": "no-store",
      },
      body: "{}",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`RPC 返回 ${response.status}：${text.slice(0, 200)}`);
    }
    return parseOrphanRows(JSON.parse(text || "[]"));
  } finally {
    clearTimeout(timer);
  }
}

/** 生成人类可读或机读报告文本。 */
function renderPayload(options, rows, summary, nowMs) {
  const generatedAt = new Date(nowMs).toISOString();
  if (options.json) {
    return JSON.stringify({ generatedAt, rpc: ORPHAN_AUDIT_RPC, summary, orphans: rows }, null, 2);
  }
  const report = formatOrphanReport(rows, summary, { nowMs, maxRows: options.maxRows });
  return [`存储孤儿巡检 ${generatedAt}`, ...report].join("\n");
}

/** 把报告写入文件（相对路径按仓库根解析），便于归档发布证据。 */
function writeReportFile(output, payload) {
  const target = path.isAbsolute(output) ? output : path.join(REPO_ROOT, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${payload}\n`);
}

/** 参数与凭据的前置检查；返回 null 表示可以继续。 */
function preflight(options, errorLog, log) {
  if (options.help) {
    log(USAGE);
    return ORPHAN_EXIT_CODES.clean;
  }
  if (!options.url || !options.serviceRoleKey) {
    errorLog("❌ 缺少 --url 或 --service-role-key（也可以用 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 提供）");
    errorLog(USAGE);
    return ORPHAN_EXIT_CODES.error;
  }
  return null;
}

/** 执行巡检，返回退出码。 */
export async function runStorageOrphanAudit(argv, dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const log = dependencies.log ?? console.log;
  const errorLog = dependencies.error ?? console.error;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const nowMs = dependencies.nowMs ?? Date.now();

  let options;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    errorLog(`❌ ${error instanceof Error ? error.message : error}`);
    errorLog(USAGE);
    return ORPHAN_EXIT_CODES.error;
  }

  const blocked = preflight(options, errorLog, log);
  if (blocked !== null) return blocked;

  let rows;
  let summary;
  try {
    rows = await fetchOrphanRows(options, fetchImpl);
    summary = summarizeOrphans(rows, nowMs);
  } catch (error) {
    errorLog(`❌ 孤儿巡检失败：${error instanceof Error ? error.message : error}`);
    return ORPHAN_EXIT_CODES.error;
  }

  const payload = renderPayload(options, rows, summary, nowMs);
  log(payload);
  if (options.output) {
    writeReportFile(options.output, payload);
    log(`已写入 ${options.output}`);
  }

  const code = decideOrphanExitCode(summary, options.failOnFindings);
  if (code === ORPHAN_EXIT_CODES.findings) {
    errorLog(`❌ 发现 ${summary.count} 个孤儿对象（--fail-on-findings）`);
  }
  return code;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runStorageOrphanAudit(process.argv.slice(2)).then((code) => process.exit(code));
}
