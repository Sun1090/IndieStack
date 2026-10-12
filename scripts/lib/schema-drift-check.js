/**
 * schema 漂移探测的 IO 层（判定在 `src/lib/db/schema-drift.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-schema-drift.js
 *   node scripts/check-schema-drift.js --url … --service-role-key … [--json] [--all-tables]
 *
 * 退出码：
 *   0  线上 schema 与代码引用一致
 *   1  发现漂移（表或列缺失）
 *   2  用法错误，或**读不到实况**（缺凭据 / 网络失败 / OpenAPI 形状变了）
 *
 * 为什么 2 而不是 1：读不到实况不是「一致」，也不是「漂移」，是「不知道」。
 * 把它压成 0 会让这条检查在没配凭据的环境里长期假绿。
 *
 * 只读：本脚本只发一个 `GET <root>/rest/v1/`（PostgREST 的 OpenAPI 根端点），
 * 不查任何一行数据、不写任何东西。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectSchemaDrift,
  parseLiveSchema,
} from "../../src/lib/db/schema-drift.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TYPES_PATH = "src/lib/supabase/database.types.ts";
const PRODUCER_DIRS = ["src/lib", "src/app", "src/components"];
const SKIP_SEGMENTS = new Set(["node_modules", ".next", "database.types.ts"]);

function walk(directory, onFile) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, onFile);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue;
    if (full.split(path.sep).some((segment) => SKIP_SEGMENTS.has(segment))) continue;
    onFile(full);
  }
}

/** 应用源码（非测试）——用于判定「代码到底引用了哪些表」。 */
export function readAppSources(repoRoot = REPO_ROOT) {
  const sources = [];
  for (const dir of PRODUCER_DIRS) {
    const absolute = path.join(repoRoot, dir);
    if (!fs.existsSync(absolute)) continue;
    walk(absolute, (file) => {
      sources.push({
        file: path.relative(repoRoot, file).split(path.sep).join("/"),
        content: fs.readFileSync(file, "utf8"),
      });
    });
  }
  return sources.sort((left, right) => left.file.localeCompare(right.file));
}

/** 无值 flag：出现即为真。 */
const BOOLEAN_FLAGS = { "--help": "help", "-h": "help", "--json": "json", "--all-tables": "allTables" };
/** 带值 flag：flag 名 → 选项名。 */
const VALUE_FLAGS = {
  "--url": "url",
  "--service-role-key": "serviceRoleKey",
  "--timeout-ms": "timeoutMs",
};

export function parseArgs(argv, env = process.env) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    json: false,
    allTables: false,
    timeoutMs: 15_000,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const boolean = Object.hasOwn(BOOLEAN_FLAGS, token) ? BOOLEAN_FLAGS[token] : null;
    if (boolean !== null) {
      options[boolean] = true;
      continue;
    }
    const value = Object.hasOwn(VALUE_FLAGS, token) ? VALUE_FLAGS[token] : null;
    if (value === null) return { error: `未知参数：${token}` };
    const raw = args[index += 1];
    options[value] = value === "timeoutMs" ? Number(raw) : (raw ?? "");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return { error: "--timeout-ms 需要一个正整数" };
  }
  return { options };
}

/**
 * 拉取 PostgREST 的 OpenAPI 根文档。
 *
 * 返回 `{ tables }` 或 `{ error }`——**不返回空数组表示「没有表」**：
 * 那种写法会把「401 未授权」显示成「线上一个表都没有」。
 */
export async function fetchLiveSchema(url, serviceRoleKey, timeoutMs = 15_000) {
  let endpoint;
  try {
    endpoint = new URL(openApiUrl(url));
  } catch {
    return { error: `URL 无法解析：${url}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/openapi+json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText}` };
    }
    return { tables: parseLiveSchema(await response.json()) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 跑一次探测并打印结果，返回进程退出码。 */
export async function runSchemaDriftCheck(options, repoRoot = REPO_ROOT) {
  const typesFile = path.join(repoRoot, TYPES_PATH);
  if (!fs.existsSync(typesFile)) {
    console.error(`❌ 找不到 ${TYPES_PATH}——没有「代码以为 schema 长什么样」的基准，比对无从谈起。`);
    return 2;
  }
  const fetched = await fetchLiveSchema(options.url, options.serviceRoleKey, options.timeoutMs);
  const report = inspectSchemaDrift(
    fs.readFileSync(typesFile, "utf8"),
    readAppSources(repoRoot),
    fetched.error ? null : fetched.tables ?? null,
  );

  if (options.json) {
    console.log(JSON.stringify({ ...report, error: fetched.error ?? null }, null, 2));
  } else {
    if (fetched.error) console.error(`❌ 读不到线上 schema：${fetched.error}`);
    for (const issue of report.issues) {
      console.log(`${issue.code === "SCHEMA_LIVE_UNREADABLE" ? "⚠️" : "❌"} [${issue.code}] ${issue.message}`);
    }
    if (report.issues.length === 0) {
      console.log(
        `✅ 线上 schema 与代码引用一致：比对 ${report.stats.referencedTables} 张表 / ` +
          `${report.stats.checkedColumns} 列（生成类型 ${report.stats.declaredTables} 张，线上 ${report.stats.liveTables} 张）`,
      );
    }
    if (report.unmanagedTables.length > 0) {
      const label = `线上有 ${report.unmanagedTables.length} 张表不在本仓库的生成类型里`;
      if (options.allTables) {
        console.log(`ℹ️ ${label}：${report.unmanagedTables.join(", ")}`);
      } else {
        console.log(`ℹ️ ${label}（代码从不引用 ⇒ 不算漂移；--all-tables 列出）`);
      }
    }
  }

  if (fetched.error) return 2;
  return report.issues.length > 0 ? 1 : 0;
}

/**
 * 从项目 URL 推出 PostgREST 的 OpenAPI 根地址。
 *
 * `NEXT_PUBLIC_SUPABASE_URL` 是**项目根**（`https://<ref>.supabase.co`），
 * OpenAPI 在 `<root>/rest/v1/`。实测（2026-10-12）：根路径直接 404，
 * 所以这里必须补上路径段；已经带 `/rest/v1` 的输入则原样使用，
 * 这样 `--url` 既能传项目 URL 也能传完整 REST 地址。
 */
export function openApiUrl(url) {
  const trimmed = url.replace(/\/+$/, "");
  return /\/rest\/v1$/.test(trimmed) ? `${trimmed}/` : `${trimmed}/rest/v1/`;
}

const HELP = [
  "用法：node scripts/check-schema-drift.js [选项]",
  "",
  "  --url <url>              Supabase 项目 URL（默认取 SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL）",
  "  --service-role-key <k>   service_role JWT（默认取 SUPABASE_SERVICE_ROLE_KEY；不会打印）",
  "  --all-tables             列出线上多出来、代码从不引用的表",
  "  --json                   机器可读输出",
  "  --timeout-ms <n>         探测超时（默认 15000）",
  "",
  "只读：只发一个 GET <rest-url>/（PostgREST OpenAPI 根端点），不查数据、不写任何东西。",
  "退出码：0 一致 / 1 发现漂移 / 2 用法错误或读不到实况（未知不算通过）",
].join("\n");

/** 解析参数、跑探测并返回退出码。 */
export async function runCli(argv, repoRoot = REPO_ROOT) {
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
  if (!parsed.options.url || !parsed.options.serviceRoleKey) {
    console.error(
      "❌ 需要 Supabase URL 与 service_role key（--url / --service-role-key，" +
        "或 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量）",
    );
    console.error("   没有它们就只能回答「未知」，而未知不算通过。");
    return 2;
  }
  return runSchemaDriftCheck(parsed.options, repoRoot);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
