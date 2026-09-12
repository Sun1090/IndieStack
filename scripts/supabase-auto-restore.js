#!/usr/bin/env node
/**
 * 免费版 Supabase 自动恢复
 *
 * 背景：Supabase 免费版项目连续 7 天无数据库活动会被自动暂停。日常保活由
 * 根目录 vercel.json 的 Vercel Cron 完成；本脚本是兜底——一旦项目真的被暂停，
 * 由 GitHub Actions 调用 Management API 把它拉起来。
 *
 * 用法：
 *   node scripts/supabase-auto-restore.js             # 检测 + 必要时恢复
 *   node scripts/supabase-auto-restore.js --dry-run   # 只检测，绝不写操作
 *
 * 环境变量：
 *   HEALTHCHECK_URL        线上 /api/health 地址
 *   SUPABASE_PROJECT_REF   Supabase 项目 ref
 *   SUPABASE_ACCESS_TOKEN  Management API 令牌（sbp_ 开头）
 *
 * 安全约束：只有在 Management API 明确报告 status=INACTIVE（即确实被暂停）时
 * 才会调用 restore。站点自身故障（部署坏了、依赖挂了）不会触发恢复。
 */

// 可用 SUPABASE_API_BASE 覆盖，便于本地用 mock 验证恢复流程（默认走线上）
const { probeHealth: probeHealthWithRetry } = require("./lib/health-probe");

const API_BASE = process.env.SUPABASE_API_BASE || "https://api.supabase.com/v1";
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_ATTEMPTS = 3;
const HEALTH_RETRY_DELAY_MS = 5_000;
const API_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

/** 项目处于这些中间态时只需等待，不必触发恢复 */
const TRANSIENT_STATES = new Set([
  "RESTORING",
  "COMING_UP",
  "UPGRADING",
  "RESTARTING",
  "PAUSING",
  "GOING_DOWN",
  "ACTIVE_UNHEALTHY",
]);

/** 不该（或无法）由本脚本处理的终态 -> 提示文案 */
const BLOCKED_MESSAGES = {
  unrecoverable: (status) => `项目状态为 ${status}，无法自动恢复，请到 Supabase 控制台处理`,
  "app-side": () =>
    "Supabase 项目本身正常，说明是应用侧故障（部署/依赖），本次不执行恢复以免误操作",
  unknown: (status) => `未预期状态 ${status}，请人工确认`,
};

const dryRun = process.argv.slice(2).includes("--dry-run");

const log = (message) => console.log(message);
const fail = (message) => console.error(`❌ ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function classify(status) {
  if (["REMOVED", "INIT_FAILED", "RESTORE_FAILED"].includes(status)) return "unrecoverable";
  if (status === "ACTIVE_HEALTHY") return "app-side";
  if (status === "INACTIVE") return "paused";
  if (TRANSIENT_STATES.has(status)) return "transient";
  return "unknown";
}

/** 读取并校验配置；缺失时打印错误并返回 null */
function readConfig() {
  const config = {
    healthUrl: process.env.HEALTHCHECK_URL,
    ref: process.env.SUPABASE_PROJECT_REF,
    token: process.env.SUPABASE_ACCESS_TOKEN,
  };
  const missing = [
    !config.healthUrl && "HEALTHCHECK_URL",
    !config.ref && "SUPABASE_PROJECT_REF",
    !config.token && "SUPABASE_ACCESS_TOKEN",
  ].filter(Boolean);
  if (missing.length > 0) {
    fail(`缺少环境变量：${missing.join("、")}`);
    return null;
  }
  return config;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 探测线上健康端点；healthy=true 表示服务与数据库都正常 */
async function probeHealth(url) {
  return probeHealthWithRetry(url, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    attempts: HEALTH_ATTEMPTS,
    retryDelayMs: HEALTH_RETRY_DELAY_MS,
    onRetry: ({ nextAttempt, attempts, result }) => {
      const detail = result.error || `HTTP ${result.status}`;
      log(`   健康探测第 ${nextAttempt - 1}/${attempts} 次失败（${detail}），准备重试…`);
    },
  });
}

/** 读取项目当前状态（INACTIVE / RESTORING / ACTIVE_HEALTHY ...） */
async function getProjectStatus(ref, token) {
  const response = await fetchWithTimeout(
    `${API_BASE}/projects/${ref}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    API_TIMEOUT_MS,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Management API ${response.status}: ${detail.slice(0, 200)}`);
  }
  const body = await response.json();
  return body?.status ?? "UNKNOWN";
}

/** 查询状态；失败时打印错误并返回 null */
async function readProjectStatus(config) {
  try {
    return await getProjectStatus(config.ref, config.token);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** POST /v1/projects/{ref}/restore —— 无请求体，Bearer 认证 */
async function triggerRestore(config) {
  log("🚑 检测到项目已暂停，调用 Management API 恢复");
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/projects/${config.ref}/restore`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
      },
      API_TIMEOUT_MS,
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`restore 失败 ${response.status}: ${detail.slice(0, 200)}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return false;
  }
  log("⏳ 恢复已触发，等待项目就绪（最长 10 分钟）");
  return true;
}

async function waitUntilHealthy(config) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await readProjectStatus(config);
    log(`   项目状态：${status}`);
    if (status === "ACTIVE_HEALTHY") {
      const probe = await probeHealth(config.healthUrl);
      if (probe.healthy) return true;
      log("   项目已就绪，等待线上端点恢复…");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function main() {
  const config = readConfig();
  if (!config) return 2;

  log(`🔍 探测 ${config.healthUrl}`);
  const probe = await probeHealth(config.healthUrl);
  if (probe.healthy) {
    log("✅ 项目健康，无需恢复");
    return 0;
  }
  log(`⚠️  端点异常（HTTP ${probe.status}${probe.error ? ` ${probe.error}` : ""}），查询项目状态`);

  const status = await readProjectStatus(config);
  if (status === null) return 1;
  log(`   项目状态：${status}`);

  const decision = classify(status);
  const blocked = BLOCKED_MESSAGES[decision];
  if (blocked) {
    fail(blocked(status));
    return 1;
  }

  if (decision === "paused") {
    if (dryRun) {
      log("🧪 dry-run：检测到已暂停，跳过恢复调用");
      return 0;
    }
    if (!(await triggerRestore(config))) return 1;
  } else {
    log(`⏳ 项目处于 ${status}，等待就绪`);
  }

  if (dryRun) {
    log("🧪 dry-run：跳过等待流程");
    return 0;
  }

  if (!(await waitUntilHealthy(config))) {
    fail("等待超时，项目仍未恢复健康，请到 Supabase 控制台确认");
    return 1;
  }
  log("✅ 项目已恢复健康");
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      fail(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

module.exports = {
  API_BASE,
  HEALTH_ATTEMPTS,
  HEALTH_RETRY_DELAY_MS,
  classify,
  main,
  probeHealth,
  readConfig,
};
