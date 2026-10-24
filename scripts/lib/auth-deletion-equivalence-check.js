/**
 * 「SQL 删除 vs 真 deleteUser」等价性探测的 IO 层（判定在
 * `src/lib/drills/auth-deletion-equivalence.ts`，由 Vitest 覆盖）。
 *
 * 用法：
 *   node scripts/auth-deletion-equivalence.js            # 需要本地栈在跑
 *   node scripts/auth-deletion-equivalence.js --prod-url "$NEXT_PUBLIC_SUPABASE_URL" --anon-key "$..."
 *     ↑ 带上生产 GoTrue 版本读数才能判「能否迁移到生产」；不带时结论自动降级为
 *       EQUIVALENT_LOCAL_ONLY，**不会**冒充「生产也这样」。
 *
 * 只打本地：`127.0.0.1:54321` 与两个本地容器。生产侧只读一个 `/auth/v1/health`
 * （版本号），没有任何生产写。
 *
 * 退出码：0 等价（含只在本地成立）/ 1 DIFFERS（等价替代不成立）/ 2 跑不成（栈没起、
 * 读数取不到）——与全仓库「未知不算通过」同一族约定。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  exitCodeForEquivalence,
  judgeAuthDeletionEquivalence,
} from "../../src/lib/drills/auth-deletion-equivalence.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB_CONTAINER = "supabase_db_indiestack";
const AUTH_CONTAINER = "supabase_auth_indiestack";
const LOCAL_BASE = "http://127.0.0.1:54321/auth/v1";
const PASSWORD = "Drill!2026#equiv";
/** auth 侧按 user_id 计的表。列名逐个实测过：这两张表**不**按 user_id 键，别加回来。 */
const USER_KEYED_TABLES = ["sessions", "refresh_tokens", "identities", "one_time_tokens", "mfa_factors"];

const VALUE_FLAGS = { "--prod-url": "prodUrl", "--anon-key": "anonKey", "--base": "base" };

export function parseArgs(argv, env = process.env) {
  const options = {
    prodUrl: env.DRILL_PROD_SUPABASE_URL || "",
    anonKey: env.DRILL_PROD_ANON_KEY || "",
    base: env.DRILL_LOCAL_AUTH_BASE || LOCAL_BASE,
    help: false,
  };
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--help" || flag === "-h") {
      options.help = true;
      continue;
    }
    const key = Object.hasOwn(VALUE_FLAGS, flag) ? VALUE_FLAGS[flag] : null;
    if (key === null) return { error: `未知参数：${flag}` };
    const raw = args[(i += 1)];
    if (raw === undefined) return { error: `${flag} 需要一个值` };
    options[key] = raw;
  }
  return { options };
}

/** 可注入的依赖：测试把 docker 与 fetch 换成桩，本地跑用真实现。 */
export function realDeps() {
  return {
    psql: (query) =>
      execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", query], {
        encoding: "utf8",
      }).trim(),
    printenv: (name) =>
      execFileSync("docker", ["exec", AUTH_CONTAINER, "printenv", name], { encoding: "utf8" }).trim(),
    fetch: (url, init) => globalThis.fetch(url, init),
  };
}

function b64url(raw) {
  return Buffer.from(raw).toString("base64url");
}

/** 用本地栈自己的 HS256 密钥签一个 service_role JWT——只对本机 GoTrue 有效，不是生产凭据。 */
export function mintServiceJwt(secret, nowSeconds) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ aud: "authenticated", role: "service_role", iss: LOCAL_BASE, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function apiCall(deps, base, method, apiPath, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers.apikey = token;
  }
  const response = await deps.fetch(`${base}${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

/** 删号前后的 auth 侧残留读数。 */
function readResidue(deps, userId) {
  const residue = {};
  for (const table of USER_KEYED_TABLES) {
    const out = deps.psql(`select count(*) from auth.${table} where user_id = '${userId}'`);
    residue[table] = out.startsWith("ERR") ? "unreadable" : out;
  }
  return residue;
}

/**
 * 取 GoTrue 版本。生产侧的 `/auth/v1/health` 实测要 apikey（不带 ⇒ **401**），
 * 所以 token 参数不是可选装饰——漏传会让「读得到」变成读不到，
 * 而下游只是安静降级，看不出自己有个 401（我今天就是这么踩的）。
 */
async function healthVersion(deps, base, token) {
  try {
    const { status, body } = await apiCall(deps, base, "GET", "/health", undefined, token);
    if (status !== 200 || !body) return null;
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * 跑一个变体：建号 → 真登录拿凭据 → 用指定方式删号 → 读残留与旧凭据可用性。
 * 返回 null 表示这个变体没跑成（调用方据此给 UNVERIFIABLE）。
 */
/** 建一个已确认的演练账号并真登录；任一步失败返回 null。 */
async function createAndLogin(deps, base, adminJwt, mode) {
  const email = `drill-eq-${mode}-local@invalid.test`;
  const created = await apiCall(deps, base, "POST", "/admin/users", { email, password: PASSWORD, email_confirm: true }, adminJwt);
  if (![200, 201].includes(created.status) || !created.body?.id) return null;
  const login = await apiCall(deps, base, "POST", "/token?grant_type=password", { email, password: PASSWORD });
  if (login.status !== 200 || !login.body?.access_token) return null;
  return { userId: created.body.id, accessToken: login.body.access_token, refreshToken: login.body.refresh_token };
}

/** 按 mode 删号。返回 false 表示删除这步本身失败。 */
async function deleteAccount(deps, base, adminJwt, userId, mode) {
  if (mode === "direct") {
    deps.psql(`delete from auth.users where id = '${userId}'`);
    return true;
  }
  const deleted = await apiCall(deps, base, "DELETE", `/admin/users/${userId}`, undefined, adminJwt);
  return deleted.status === 200;
}

/**
 * 跑一个变体：建号 → 真登录拿凭据 → 用指定方式删号 → 读残留与旧凭据可用性。
 * 返回 null 表示这个变体没跑成（调用方据此给 UNVERIFIABLE）。
 */
export async function runVariant(deps, base, adminJwt, mode) {
  const session = await createAndLogin(deps, base, adminJwt, mode);
  if (session === null) return null;
  const { userId, accessToken, refreshToken } = session;
  if (!(await deleteAccount(deps, base, adminJwt, userId, mode))) return null;
  const residue = readResidue(deps, userId);
  const refreshed = await apiCall(deps, base, "POST", "/token?grant_type=refresh_token", { refresh_token: refreshToken });
  const withOldAccess = await apiCall(deps, base, "GET", "/user", undefined, accessToken);
  const version = await healthVersion(deps, base, adminJwt);
  return {
    residue,
    refreshStatus: refreshed.status,
    accessStatus: withOldAccess.status,
    gotrueVersion: version ?? "unknown",
  };
}
export async function runEquivalenceProbe(options, deps = realDeps()) {
  let jwtSecret = "";
  try {
    jwtSecret = deps.printenv("GOTRUE_JWT_SECRET");
  } catch {
    console.error("❌ 取不到本地 GOTRUE_JWT_SECRET——本地栈的 auth 容器没在跑？");
    return 2;
  }
  if (!jwtSecret) {
    console.error("❌ 本地 GOTRUE_JWT_SECRET 为空");
    return 2;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const adminJwt = mintServiceJwt(jwtSecret, nowSeconds);
  const base = options.base || LOCAL_BASE;

  const sqlResult = await runVariant(deps, base, adminJwt, "direct");
  const adminResult = await runVariant(deps, base, adminJwt, "admin");
  if (sqlResult === null || adminResult === null) {
    console.error("❌ 至少一个变体没跑成（建号 / 登录 / 删号任一失败）——不给结论");
    return 2;
  }

  let productionVersion = null;
  if (options.prodUrl && options.anonKey) {
    const prodBase = `${String(options.prodUrl).replace(/\/+$/, "")}/auth/v1`;
    productionVersion = await healthVersion(deps, prodBase, options.anonKey);
    if (productionVersion === null) console.warn("⚠️ 读不到生产 GoTrue 版本 ⇒ 结论自动降级为「只在本地成立」");
  } else {
    console.warn("⚠️ 未给 --prod-url（生产 GoTrue 版本）⇒ 不判「可迁移到生产」");
  }

  const report = judgeAuthDeletionEquivalence(sqlResult, adminResult, productionVersion ?? undefined);
  const mark = report.verdict === "DIFFERS" ? "❗" : report.verdict === "UNVERIFIABLE" ? "⚠️" : "✅";
  console.log(`${mark} [${report.verdict}] ${report.evidence}`);
  console.log(`   本地 GoTrue：${sqlResult.gotrueVersion}；删前→删后（两种删法相同则只列一次）`);
  console.log(`   direct 残留：${JSON.stringify(sqlResult.residue)}`);
  console.log(`   admin  残留：${JSON.stringify(adminResult.residue)}`);
  console.log(`   旧凭据：refresh HTTP ${sqlResult.refreshStatus}/${adminResult.refreshStatus}，/user HTTP ${sqlResult.accessStatus}/${adminResult.accessStatus}`);
  console.log("   演练账号已自删（两种删法本身就是清理）；本探测只打本地栈，生产侧只读 /auth/v1/health");
  return exitCodeForEquivalence(report.verdict);
}

const HELP = [
  "用法：node scripts/auth-deletion-equivalence.js [选项]",
  "",
  "  --base <url>       本地 GoTrue 基址（默认 http://127.0.0.1:54321/auth/v1）",
  "  --prod-url <url>   生产 Supabase URL（只读 /auth/v1/health 取版本，用于判可迁移性）",
  "  --anon-key <k>     生产 anon key（随 --prod-url 一起给）",
  "",
  "跑两遍同一个演练：`delete from auth.users` 与真 `DELETE /auth/v1/admin/users/<id>`，",
  "比对 auth 侧残留与旧凭据（refresh_token / access_token）的可用性。",
  "只写本地栈；账号自删。退出码：0 等价 / 1 有差异 / 2 跑不成（未知不算通过）。",
].join("\n");

export async function runCli(argv, deps = realDeps(), repoRoot = REPO_ROOT) {
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
  return runEquivalenceProbe(parsed.options, deps);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
