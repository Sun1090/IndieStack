#!/usr/bin/env node

/**
 * 把 docs/design/email-templates.md 的 Auth 邮件模板与重定向白名单同步到 Supabase 项目。
 *
 * 用法：
 *   pnpm auth:email-config                          # dry-run：打印将要修改的字段
 *   pnpm auth:email-config -- --apply               # 真正写入 Management API
 *   pnpm auth:email-config -- --verify              # 只读取线上配置并校验是否已一致
 *   pnpm auth:email-config -- --apply --scope=redirects
 *
 * scope：all（默认，模板 + 白名单）| templates | redirects。
 * Supabase 免费套餐使用默认发件人时禁止改模板，此时可先用 --scope=redirects
 * 应用重定向白名单；配置自定义 SMTP 或升级套餐后再跑 all。
 *
 * 凭据：SUPABASE_ACCESS_TOKEN（Management API token）、SUPABASE_PROJECT_REF。
 * 可用 SUPABASE_API_BASE 覆盖 API 地址，便于本地 mock 演练。
 */

const {
  describeApplyFailure,
  mergeRedirectAllowList,
  normalizeScope,
  planAuthConfigUpdate,
  verifyAuthConfig,
} = require("./lib/auth-email-templates");

const API_BASE = process.env.SUPABASE_API_BASE || "https://api.supabase.com/v1";
const API_TIMEOUT_MS = 20_000;

/** 提取 Management API 的错误摘要，便于排障且不回显完整响应体（可能含密钥） */
function describeApiError(prefix, response, body) {
  const detail =
    body && typeof body === "object" && typeof body.message === "string"
      ? body.message.slice(0, 200)
      : "";
  return detail
    ? `${prefix}: HTTP ${response.status} - ${detail}`
    : `${prefix}: HTTP ${response.status}`;
}

function readConfig(env = process.env) {
  const token = env.SUPABASE_ACCESS_TOKEN;
  const projectRef = env.SUPABASE_PROJECT_REF;
  const missing = [];
  if (!token) missing.push("SUPABASE_ACCESS_TOKEN");
  if (!projectRef) missing.push("SUPABASE_PROJECT_REF");
  if (missing.length > 0) {
    return { ok: false, missing, token, projectRef };
  }
  return { ok: true, missing: [], token, projectRef };
}

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const mode = args.find((arg) => arg === "--apply" || arg === "--verify") ?? "--dry-run";
  const scopeFlag = args.find((arg) => arg.startsWith("--scope="));
  const scope = scopeFlag ? scopeFlag.slice("--scope=".length) : undefined;
  if (scope !== undefined) normalizeScope(scope);

  const unknown = args.filter((arg) => !arg.startsWith("--"));
  if (unknown.length > 0) {
    throw new Error(`unexpected argument: ${unknown[0]}`);
  }
  const known = new Set(["--apply", "--verify", "--dry-run", "--"]);
  const unexpectedFlag = args.find((arg) => !known.has(arg) && !arg.startsWith("--scope="));
  if (unexpectedFlag) {
    throw new Error(`unknown flag: ${unexpectedFlag}`);
  }
  return { mode, scope };
}

async function fetchAuthConfig({ token, projectRef, fetchImpl = fetch, apiBase = API_BASE }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${apiBase}/projects/${projectRef}/config/auth`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(describeApiError("failed to read auth config", response, body));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function applyAuthConfig({
  token,
  projectRef,
  patch,
  fetchImpl = fetch,
  apiBase = API_BASE,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${apiBase}/projects/${projectRef}/config/auth`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(patch),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(describeApiError("failed to update auth config", response, body));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** --verify：只读校验，返回进程退出码 */
function runVerify(current, scope) {
  const plan = planAuthConfigUpdate(current, scope);
  const result = verifyAuthConfig(current, { expected: plan });
  if (!result.ok) {
    console.error(
      `❌ Auth 配置（scope=${plan.scope}）与设计稿不一致，字段：${result.mismatches.join(", ")}`,
    );
    return 1;
  }
  if (plan.changedFields.length > 0) {
    console.error(`❌ Auth 配置（scope=${plan.scope}）仍需更新：${plan.changedFields.join(", ")}`);
    return 1;
  }
  console.log(
    `✅ Auth 配置已验证（scope=${plan.scope}，${plan.expectedFields.length} 个字段一致）`,
  );
  return 0;
}

/** dry-run / apply：打印计划并在需要写入时调用 Management API */
async function runUpdate(current, { mode, scope, token, projectRef }) {
  const plan = planAuthConfigUpdate(current, scope);
  if (plan.changedFields.length === 0) {
    console.log("✅ Auth 邮件配置已是最新，无需写入");
    return 0;
  }

  console.log(`计划修改 ${plan.changedFields.length} 个字段：`);
  for (const field of plan.changedFields) console.log(`  - ${field}`);
  console.log(`重定向白名单：${plan.allowList}`);

  if (mode === "--dry-run") {
    console.log("ℹ️ dry-run 结束，未写入任何变更；使用 --apply 执行");
    return 0;
  }

  try {
    const updated = await applyAuthConfig({ token, projectRef, patch: plan.patch });
    const result = verifyAuthConfig(updated, { expected: plan });
    if (!result.ok) {
      console.error(`❌ 写入后校验失败，字段：${result.mismatches.join(", ")}`);
      return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${message}`);
    const hint = describeApplyFailure(message);
    if (hint) console.error(`ℹ️ ${hint}`);
    return 1;
  }

  console.log(`✅ 已写入并校验 ${plan.changedFields.length} 个字段（scope=${plan.scope}）`);
  return 0;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    return 2;
  }

  const config = readConfig(env);
  if (!config.ok) {
    console.error(`❌ 缺少配置：${config.missing.join(", ")}`);
    return 2;
  }
  const { token, projectRef } = config;

  let current;
  try {
    current = await fetchAuthConfig({ token, projectRef });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (parsed.mode === "--verify") return runVerify(current, parsed.scope);
  return runUpdate(current, { ...parsed, token, projectRef });
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}

module.exports = {
  API_BASE,
  applyAuthConfig,
  describeApiError,
  parseArgs,
  fetchAuthConfig,
  main,
  mergeRedirectAllowList,
  readConfig,
};
