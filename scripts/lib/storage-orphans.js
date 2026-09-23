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
  diffProviderObjects,
  formatOrphanReport,
  formatProviderDiffLines,
  parseOrphanRows,
  providerDiffFindings,
  summarizeOrphans,
  walkProviderBucket,
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
  "  --provider-diff       额外列一遍 bucket 并与元数据表做集合差（C05）：发现从未落过",
  "                        元数据的存量对象。要多走一整趟列目录，默认关闭",
  "  --bucket <name>       --provider-diff 要列的 bucket（默认 avatars）",
  "  --max-pages <n>       列目录的请求数上限（默认 200；触顶即报「清单不完整」并 exit 1）",
  "  --help                显示本帮助",
  "",
  "只读巡检：调用 find_orphan_upload_objects()，不删除任何对象。",
  "不带 --provider-diff 时清单只覆盖落过 upload_objects 元数据的对象；",
  "031 之前直接写入 bucket、从未登记过元数据的存量要靠 --provider-diff 才看得见。",
].join("\n");

const FLAG_KEYS = new Map([
  ["--url", "url"],
  ["--service-role-key", "serviceRoleKey"],
  ["--output", "output"],
  ["--max-rows", "maxRows"],
  ["--timeout-ms", "timeoutMs"],
  ["--bucket", "bucket"],
  ["--max-pages", "maxPages"],
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
  if (key === "maxRows" || key === "timeoutMs" || key === "maxPages") {
    options[key] = readPositiveInt(token, value);
    return;
  }
  if (key === "bucket") {
    if (!BUCKET_PATTERN.test(value)) {
      throw new Error(
        `bucket 名非法（${token} 只接受字母、数字、点、下划线或连字符，且不能含 / 或空白）`,
      );
    }
    options[key] = value;
    return;
  }
  options[key] = value;
}

/** bucket 名直接进 URL 路径，所以只接受存储侧允许的字符集，杜绝 `../` 之类的路径注入。 */
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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
    providerDiff: false,
    bucket: "avatars",
    maxPages: 200,
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
    if (token === "--provider-diff") {
      options.providerDiff = true;
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

/** 校验地址并拼出 API 根；只接受 http/https，避免把凭据发去意外协议。 */
function apiRoot(rawUrl) {
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
  return `${url.protocol}//${url.host}${base}`;
}

export function orphanRpcEndpoint(rawUrl) {
  return `${apiRoot(rawUrl)}/rest/v1/rpc/${ORPHAN_AUDIT_RPC}`;
}

/** 列目录端点。bucket 名走的是路径，所以先过字符集校验。 */
export function storageListEndpoint(rawUrl, bucket) {
  if (!BUCKET_PATTERN.test(String(bucket ?? ""))) {
    throw new Error(`bucket 名非法：${bucket}`);
  }
  return `${apiRoot(rawUrl)}/storage/v1/object/list/${bucket}`;
}

/** 元数据表的分页读端点。`order` 是必需的：没有全序，offset 分页会漏行或重读。 */
export function uploadObjectsEndpoint(rawUrl, offset, limit) {
  const params = new URLSearchParams({
    select: "bucket,object_key,status",
    order: "bucket.asc,object_key.asc",
    limit: String(limit),
    offset: String(offset),
  });
  return `${apiRoot(rawUrl)}/rest/v1/upload_objects?${params.toString()}`;
}

function serviceHeaders(options, extra = {}) {
  return {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    "cache-control": "no-store",
    ...extra,
  };
}

/** 发一次带超时的只读请求；非 2xx 抛错，响应体只留前 200 字符。 */
async function requestText(options, fetchImpl, url, init, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label} 返回 ${response.status}：${text.slice(0, 200)}`);
    }
    return { text, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** 调用一次 RPC，返回已解析的行。 */
export async function fetchOrphanRows(options, fetchImpl = globalThis.fetch) {
  const { text } = await requestText(
    options,
    fetchImpl,
    orphanRpcEndpoint(options.url),
    {
      method: "POST",
      headers: serviceHeaders(options, { "content-type": "application/json" }),
      body: "{}",
    },
    "RPC",
  );
  return parseOrphanRows(JSON.parse(text || "[]"));
}

/**
 * 解析 PostgREST 的 `Content-Range`。
 *
 * 只有总数能证明「这一页之后没有更多行了」——短页本身不算证据，
 * 因为服务端可能按自己的上限截断。返回 `null` 表示拿不到总数。
 */
export function parseContentRange(value) {
  if (typeof value !== "string") return null;
  const match = /^\s*(?:\d+-\d+|\*)\s*\/\s*(\d+)\s*$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** 校验元数据表的一页；status 不认识或缺列都抛，不悄悄当成 active。 */
function parseTrackedPage(page) {
  if (!Array.isArray(page)) throw new Error(`元数据表返回的不是数组：${typeof page}`);
  return page.map((entry) => {
    const row = entry ?? {};
    const { bucket, status } = row;
    const objectKey = row.object_key;
    if (status !== "active" && status !== "deleted") {
      throw new Error(`元数据行的 status 不认识：${String(status)}`);
    }
    if (typeof bucket !== "string" || typeof objectKey !== "string" || !objectKey) {
      throw new Error("元数据行缺少 bucket 或 object_key");
    }
    return { bucket, objectKey, status };
  });
}

/**
 * 从 `Content-Range` 拿总行数。
 *
 * 拿不到就抛：短页本身不是「读完了」的证据（服务端可能按自己的上限截断），
 * 而「没读完」被说成「都在这儿」正是这类巡检最危险的失败方式。
 */
function readRangeTotal(headers) {
  const total = parseContentRange(headers?.get?.("content-range") ?? null);
  if (total === null) {
    throw new Error("元数据表响应没有可用的 Content-Range，无法确认是否读全");
  }
  return total;
}

/**
 * 读 `upload_objects` 的全部键。
 *
 * `maxRequests` 与列目录那一侧共用 `--max-pages`：两条链路都必须有「看完之前先停下」的闸门，
 * 否则一张意外大的元数据表会让这趟巡检把「还没读完」一路读下去。
 *
 * @returns {Promise<{ rows: Array<{bucket: string, objectKey: string, status: string}>, requests: number }>}
 */
export async function fetchTrackedObjects(
  options,
  fetchImpl = globalThis.fetch,
  pageSize = 1000,
  maxRequests = 200,
) {
  const rows = [];
  let requests = 0;
  for (;;) {
    if (requests >= maxRequests) {
      throw new Error(
        `元数据表分页已达上限 ${maxRequests} 次（读到 ${rows.length} 行）；把 --max-pages 调大之后重跑`,
      );
    }
    const { text, headers } = await requestText(
      options,
      fetchImpl,
      uploadObjectsEndpoint(options.url, rows.length, pageSize),
      { method: "GET", headers: serviceHeaders(options, { Prefer: "count=exact" }) },
      "元数据表",
    );
    requests += 1;
    const page = parseTrackedPage(JSON.parse(text || "[]"));
    rows.push(...page);
    const total = readRangeTotal(headers);
    if (rows.length > total) {
      throw new Error(`元数据表读到的行数 ${rows.length} 超过总数 ${total}，分页已不可信`);
    }
    if (rows.length === total) return { rows, requests };
    if (page.length === 0) {
      throw new Error(`元数据表读到 ${rows.length} 行就空了，但总数报的是 ${total}`);
    }
  }
}

/**
 * 确认要列的 bucket 真的存在。
 *
 * 存储侧对「不存在的 bucket」列目录返回的是 200 + 空数组（本地栈实测），于是 `--bucket` 上
 * 一个拼错的名称会产出「0 个对象、0 项发现」——巡检最危险的失败方式就是把「我们谁也没查到」
 * 报成一次干净的结果，所以这一步必须先立起来。
 */
export async function fetchBucketNames(options, fetchImpl = globalThis.fetch) {
  const { text } = await requestText(
    options,
    fetchImpl,
    `${apiRoot(options.url)}/storage/v1/bucket`,
    { method: "GET", headers: serviceHeaders(options) },
    "bucket 清单",
  );
  const payload = JSON.parse(text || "[]");
  if (!Array.isArray(payload)) throw new Error(`bucket 清单返回的不是数组：${typeof payload}`);
  return payload
    .map((entry) => (entry && typeof entry === "object" ? entry.name : null))
    .filter((name) => typeof name === "string");
}

/** 列一遍 bucket 并与元数据表做集合差（C05）。清单不完整时抛错，绝不报「没有存量孤儿」。 */
export async function fetchProviderDiff(options, fetchImpl = globalThis.fetch, pageSize = 500) {
  const knownBuckets = await fetchBucketNames(options, fetchImpl);
  if (!knownBuckets.includes(options.bucket)) {
    throw new Error(
      `bucket ${options.bucket} 在服务端不存在（认识的是：${knownBuckets.join(", ") || "无"}）；` +
        "列一个不存在的 bucket 会返回空集，那不能算「没有存量孤儿」",
    );
  }

  const listPage = async (prefix, offset) => {
    const { text } = await requestText(
      options,
      fetchImpl,
      storageListEndpoint(options.url, options.bucket),
      {
        method: "POST",
        headers: serviceHeaders(options, { "content-type": "application/json" }),
        body: JSON.stringify({
          prefix,
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      },
      "列目录",
    );
    return JSON.parse(text || "[]");
  };

  const tracked = await fetchTrackedObjects(options, fetchImpl, 1000, options.maxPages);
  const walked = await walkProviderBucket({
    bucket: options.bucket,
    listPage,
    limits: { pageSize, maxPages: options.maxPages },
  });
  if (!walked.complete) {
    throw new Error(
      `列目录没有走完（停在 ${walked.stoppedAt ?? "未知位置"}，已用 ${walked.pages} 页）；` +
        `把 --max-pages 调大之后重跑`,
    );
  }
  return { diff: diffProviderObjects(walked, tracked.rows), trackedRequests: tracked.requests };
}

/** 生成人类可读或机读报告文本。 */
function renderPayload(options, rows, summary, nowMs, provider) {
  const generatedAt = new Date(nowMs).toISOString();
  if (options.json) {
    return JSON.stringify(
      {
        generatedAt,
        rpc: ORPHAN_AUDIT_RPC,
        summary,
        orphans: rows,
        providerDiff: provider ? provider.diff : null,
      },
      null,
      2,
    );
  }
  const report = formatOrphanReport(rows, summary, { nowMs, maxRows: options.maxRows });
  if (provider) {
    report.push(...formatProviderDiffLines(provider.diff, options.maxRows));
  }
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

/**
 * 依赖注入的默认值。
 *
 * 单独抽出来是因为 `??` 在圈复杂度里也算分支——全塞进主函数会把它压成一张分支表，
 * 而测试要的只是「能换掉这五个东西」。
 */
function resolveDeps(dependencies) {
  return {
    env: dependencies.env ?? process.env,
    log: dependencies.log ?? console.log,
    errorLog: dependencies.error ?? console.error,
    fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
    nowMs: dependencies.nowMs ?? Date.now(),
  };
}

/** 执行巡检，返回退出码。 */
export async function runStorageOrphanAudit(argv, dependencies = {}) {
  const { env, log, errorLog, fetchImpl, nowMs } = resolveDeps(dependencies);

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
  let provider;
  try {
    rows = await fetchOrphanRows(options, fetchImpl);
    summary = summarizeOrphans(rows, nowMs);
    if (options.providerDiff) provider = await fetchProviderDiff(options, fetchImpl);
  } catch (error) {
    errorLog(`❌ 孤儿巡检失败：${error instanceof Error ? error.message : error}`);
    return ORPHAN_EXIT_CODES.error;
  }

  const payload = renderPayload(options, rows, summary, nowMs, provider);
  log(payload);
  if (options.output) {
    writeReportFile(options.output, payload);
    log(`已写入 ${options.output}`);
  }

  const diffFindings = provider ? providerDiffFindings(provider.diff) : 0;
  const code = decideOrphanExitCode(summary, options.failOnFindings, diffFindings);
  if (code === ORPHAN_EXIT_CODES.findings) {
    errorLog(
      `❌ 发现 ${summary.count} 个孤儿对象` +
        (provider ? ` + ${diffFindings} 项 provider 集合差发现` : "") +
        "（--fail-on-findings）",
    );
  }
  return code;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runStorageOrphanAudit(process.argv.slice(2)).then((code) => process.exit(code));
}
