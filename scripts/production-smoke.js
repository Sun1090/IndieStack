#!/usr/bin/env node
/**
 * Side-effect-free production smoke checks for IndieStack.
 *
 * Usage:
 *   pnpm smoke:production -- https://indie-stack-theta.vercel.app
 *   pnpm smoke:production -- https://example.com --expected-version 0.6.0 --output smoke.json
 *   pnpm smoke:production -- https://example.com --expected-commit 2b52ce1f  # 短 SHA 也可
 *
 * The suite only performs GET requests and one intentionally invalid webhook POST.
 * It never follows redirects for the protected dashboard check and never sends credentials.
 */
const fs = require("fs");
const path = require("path");
const { DEFAULT_ATTEMPTS, DEFAULT_RETRY_DELAY_MS, probeHealth } = require("./lib/health-probe");

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * `--flag value` 与 `--flag=value` 两种写法共用的取值表。
 * 查表必须走 `Object.hasOwn`，否则位置参数叫 `constructor` 时会命中原型上的属性。
 */
const CLI_FLAGS = {
  "--expected-version": "expectedVersion",
  "--expected-commit": "expectedCommit",
  "--output": "output",
  "--timeout-ms": "timeoutMs",
};

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    url: undefined,
    expectedVersion: undefined,
    expectedCommit: undefined,
    output: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  let index = 0;

  const readValue = (flag) => {
    index += 1;
    const value = args[index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!Object.hasOwn(CLI_FLAGS, name)) {
      if (!arg.startsWith("-") && !options.url) options.url = arg;
      continue;
    }
    const raw = equals === -1 ? readValue(name) : arg.slice(equals + 1);
    options[CLI_FLAGS[name]] = name === "--timeout-ms" ? Number(raw) : raw;
  }

  return validateOptions(options);
}

/** 空值与「等于没断言」的期望值都在入口拒掉；未提供的字段回落到环境变量。 */
function validateOptions(options) {
  for (const [flag, value] of [
    ["--expected-version", options.expectedVersion],
    ["--expected-commit", options.expectedCommit],
    ["--output", options.output],
  ]) {
    if (value === "") throw new Error(`${flag} requires a non-empty value`);
  }
  // 按前缀比较：1 个字符的「期望 commit」能匹配任何构建，等于没有断言。
  if (options.expectedCommit && options.expectedCommit.trim().length < 7) {
    throw new Error("--expected-commit must be at least 7 characters (a short SHA)");
  }
  return {
    ...options,
    url: options.url ?? process.env.PRODUCTION_URL,
    expectedVersion: options.expectedVersion ?? process.env.EXPECTED_APP_VERSION,
    expectedCommit: options.expectedCommit ?? process.env.EXPECTED_APP_COMMIT,
  };
}

function parseBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid production URL: ${value ?? "(missing)"}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("Production URL must use http or https");
  if (parsed.username || parsed.password)
    throw new Error("Production URL must not contain credentials");
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed;
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.origin}/`).toString();
}

async function request(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function result(name, passed, detail, status, extra = {}) {
  return { name, passed, detail, status, ...extra };
}

function headerIncludes(headers, name, expected) {
  const value = headers.get(name);
  return typeof value === "string" && value.toLowerCase().includes(expected.toLowerCase());
}

/**
 * 生产上报的构建 commit 与期望值是否同一次构建。
 *
 * 期望值允许是短 SHA（`git rev-parse --short` 的产物），因此按前缀比较；但**没有**期望值时
 * 一律返回 true，由调用方决定是否把「生产未上报 commit」当作信息缺失记录。
 */
function commitMatches(observed, expected) {
  if (!expected) return true;
  if (typeof observed !== "string" || observed.trim().length === 0) return false;
  return observed.trim().toLowerCase().startsWith(expected.trim().toLowerCase());
}

/**
 * 生产上报的构建身份，三种情况必须分开读：
 * - **键不在**（`not-reported`）：那份构建早于 `/api/health` 开始上报 commit 的改动，
 *   也就是说生产跑的是旧构建——这跟「构建时拿不到 git 变量」是两件事，混成一条读数就会
 *   把平台配置问题与部署滞后当成同一个症状。
 * - 键在但没有值（`no-build-env`）：构建身份没被注入（Vercel 的 System Environment Variables
 *   没开，或不是从 git 部署的）。
 * - 键在有值：短 SHA。
 */
function commitLabel(body) {
  if (!body || !Object.hasOwn(body, "commit")) return "not-reported";
  const value = body.commit;
  if (typeof value !== "string" || value.trim().length === 0) return "no-build-env";
  return value.trim().slice(0, 7);
}

/** 证据文件（顶层或 health 那条检查）里的 commit 该读成哪一种。 */
function describeEvidenceCommit(evidence) {
  if (!evidence || evidence.commitReported !== true) return "not-reported";
  return commitLabel({ commit: evidence.commit });
}

function healthFailureDetail(response, body, versionMatches, expectedVersion, commitOk, expectedCommit) {
  const version = body?.version ?? "missing";
  const checks = [
    [`HTTP ${response.status}`, response.status === 200],
    [`status=${body?.status ?? "invalid"}`, body?.status === "ok"],
    [`ready=${String(body?.ready)}`, body?.ready === true],
    ["cache-control", headerIncludes(response.headers, "cache-control", "no-store")],
    ["x-request-id", Boolean(response.headers.get("x-request-id"))],
    [`version=${version}, expected=${expectedVersion ?? "unknown"}`, versionMatches],
    [
      `commit=${commitLabel(body)}, expected=${expectedCommit ?? "unset"}`,
      commitOk,
    ],
  ];
  const failed = checks
    .filter(([, passed]) => !passed)
    .map(([label, passed]) => (passed ? null : label));
  return failed.filter((label) => label !== null).join(", ") || "invalid health response";
}

async function checkHealth(baseUrl, options) {
  const expectedVersion = options.expectedVersion;
  const expectedCommit = options.expectedCommit;
  const probeResult = await probeHealth(joinUrl(baseUrl, "/api/health"), {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    attempts: options.healthAttempts,
    retryDelayMs: options.healthRetryDelayMs,
    sleepImpl: options.sleepImpl,
    responseInit: { headers: { Accept: "application/json" } },
    validate: (candidate) => {
      const versionMatches = !expectedVersion || candidate.body?.version === expectedVersion;
      return (
        candidate.status === 200 &&
        candidate.body?.status === "ok" &&
        candidate.body?.ready === true &&
        headerIncludes(candidate.headers, "cache-control", "no-store") &&
        Boolean(candidate.headers?.get("x-request-id")) &&
        versionMatches &&
        commitMatches(candidate.body?.commit, expectedCommit)
      );
    },
    onRetry: ({ attempt, attempts, result: failed }) => {
      const detail = failed.error || `HTTP ${failed.status}`;
      console.warn(`⚠️ health attempt ${attempt}/${attempts} failed (${detail}); retrying`);
    },
  });
  const response = {
    status: probeResult.status,
    headers: probeResult.headers ?? new Headers(),
  };
  const body = probeResult.body;
  const versionMatches = !options.expectedVersion || body?.version === options.expectedVersion;
  const commitOk = commitMatches(body?.commit, expectedCommit);
  const passed = probeResult.healthy;
  const detail = passed
    ? `HTTP 200, status=ok, ready=true, version=${body.version}, commit=${commitLabel(body)}${probeResult.attempts > 1 ? ` (attempt ${probeResult.attempts})` : ""}`
    : healthFailureDetail(
        response,
        body,
        versionMatches,
        options.expectedVersion,
        commitOk,
        expectedCommit,
      );
  return result("health", passed, detail, response.status, {
    version: body?.version ?? null,
    commit: body?.commit ?? null,
    // 「键在不在」本身是一格证据：不在=那份构建早于上报 commit 的改动，与「键在但值为空」
    // （构建时没注入 git 变量）是两种不同的故障，合成一格就没法分诊。
    commitReported: Boolean(body) && Object.hasOwn(body, "commit"),
    expectedCommit: expectedCommit ?? null,
    attempts: probeResult.attempts,
  });
}

async function checkHomepage(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/"),
    {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    },
    options.timeoutMs,
  );
  const html = await response.text();
  const passed =
    response.status === 200 &&
    headerIncludes(response.headers, "content-type", "text/html") &&
    /<!doctype html/i.test(html) &&
    /id=["']main-content["']/.test(html);
  const detail = passed
    ? "HTTP 200, HTML and #main-content present"
    : `HTTP ${response.status}, content-type=${response.headers.get("content-type") ?? "missing"}, main-content=${/id=["']main-content["']/.test(html)}`;
  return result("homepage", passed, detail, response.status);
}

/**
 * 存活探针。
 *
 * **为什么它值得成为一条发布门禁**：它断言的不是「200」，而是**这条端点仍然没有被并回
 * 就绪探针**——具体是「不返回 `checks` / `version` / `commit`」。
 * 高频探针的价值全在「不打数据库、不暴露部署身份」这两点上，而这两点没有别的门禁看着：
 * 哪天有人觉得「两条端点重复了，合成一条吧」，本地单测不会红（它们各自都对），
 * 只有部署后的这一条会。
 */
async function checkLiveness(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/api/health/live"),
    { method: "GET", redirect: "manual" },
    options.timeoutMs,
  );
  let body = null;
  try {
    body = await response.json();
  } catch {
    // 解析失败时 passed 自然为 false，错误信息在下面报
  }
  const leaked = ["checks", "allConfigured", "ready", "version", "commit", "uptime"].filter(
    (key) => body && Object.prototype.hasOwnProperty.call(body, key),
  );
  const passed =
    response.status === 200 &&
    body?.status === "ok" &&
    typeof body?.timestamp === "string" &&
    leaked.length === 0;
  return result(
    "liveness",
    passed,
    passed
      ? "HTTP 200, status=ok, no dependency or build-identity fields"
      : leaked.length > 0
        ? `HTTP ${response.status}, 存活探针泄露了本不该有的字段：${leaked.join(", ")}`
        : `HTTP ${response.status}, status=${body?.status ?? "unparsable"}`,
    response.status,
  );
}

async function checkStaticAsset(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/icon.svg"),
    {
      method: "GET",
      redirect: "manual",
    },
    options.timeoutMs,
  );
  const body = await response.text();
  const passed =
    response.status === 200 &&
    headerIncludes(response.headers, "content-type", "image/svg+xml") &&
    /<svg[\s>]/i.test(body);
  return result(
    "static-asset",
    passed,
    passed
      ? "HTTP 200, icon.svg served as SVG"
      : `HTTP ${response.status}, content-type=${response.headers.get("content-type") ?? "missing"}`,
    response.status,
  );
}

async function checkSecurityHeaders(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/"),
    {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    },
    options.timeoutMs,
  );
  await response.text();
  const headers = response.headers;
  const checks = {
    csp:
      headerIncludes(headers, "content-security-policy", "default-src 'self'") &&
      headerIncludes(headers, "content-security-policy", "frame-ancestors 'none'"),
    hsts:
      /max-age=(\d+)/.test(headers.get("strict-transport-security") ?? "") &&
      Number(RegExp.$1) >= 31_536_000,
    nosniff: headers.get("x-content-type-options")?.toLowerCase() === "nosniff",
    frame: headers.get("x-frame-options")?.toUpperCase() === "DENY",
    referrer: headers.get("referrer-policy") === "strict-origin-when-cross-origin",
    permissions: Boolean(headers.get("permissions-policy")),
    requestId: Boolean(headers.get("x-request-id")),
  };
  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return result(
    "security-headers",
    response.status === 200 && failed.length === 0,
    failed.length
      ? `missing/invalid: ${failed.join(", ")}`
      : "CSP, HSTS, nosniff, frame, referrer, permissions and request-id present",
    response.status,
    { checks },
  );
}

async function checkUnauthorizedDashboard(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/dashboard"),
    {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/html" },
    },
    options.timeoutMs,
  );
  const location = response.headers.get("location") ?? "";
  const loginPath = location ? new URL(location, baseUrl.origin).pathname : "";
  const passed = response.status >= 300 && response.status < 400 && loginPath === "/auth/login";
  return result(
    "anonymous-dashboard",
    passed,
    passed
      ? `HTTP ${response.status} redirects to /auth/login`
      : `HTTP ${response.status}, location=${location || "missing"}`,
    response.status,
    { location: location || null },
  );
}

async function checkWebhookRejection(baseUrl, options) {
  const response = await request(
    options.fetchImpl,
    joinUrl(baseUrl, "/api/webhooks/stripe"),
    {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    },
    options.timeoutMs,
  );
  const body = await response.json().catch(() => null);
  const passed =
    response.status === 400 &&
    body?.error === "Missing signature" &&
    headerIncludes(response.headers, "cache-control", "no-store");
  return result(
    "webhook-signature-rejection",
    passed,
    passed
      ? "HTTP 400, missing signature rejected without side effects"
      : `HTTP ${response.status}, error=${body?.error ?? "invalid body"}`,
    response.status,
  );
}

/**
 * 生产调度表里的每条 cron 路径都必须接受 **HTTP GET**。
 *
 * 存在的理由是一条已发生的线上事故：Vercel Cron 的触发方式是「向生产 URL 发一个 HTTP GET」
 * （见 https://vercel.com/docs/cron-jobs ），而本仓库的 `digest` 与 `retention` 只导出过 POST，
 * 于是平台每天拿到 Next.js 的 `405 Method Not Allowed`——**worker 自被调度那天起一次都没执行过**。
 *
 * 为什么这条必须有线上读数：405 发生在**进入路由之前**，所以
 *   - `cron.auth.rejected` 不会产出（鉴权代码根本没跑到），
 *   - 任何业务指标都不会产出（看起来与「队列为空时的安静」一模一样），
 *   - `/api/health` 与其余各步冒烟全绿（它们打的是别的端点、或别的方法）。
 * `pnpm check:cron-contract` 能拦住「注册表漏写 GET」，但拦不住
 * 「导出形状后来被改坏」「平台改了触发方法」「生产上跑的那个构建不是这个形状」。
 *
 * 判定口径（不带任何凭据，因此这一步**不会真的执行 worker**，仍然无副作用）：
 * - `401` / `403` ⇒ 绿：方法被接受、只是没带凭据，正是「配上 CRON_SECRET 就会跑」的形状。
 * - `2xx` 且 `application/json` ⇒ 绿：该路径本来就公开（`/api/health` 保活探测）。
 * - 其它（含 `405`、也含 `200 + HTML`）⇒ 红。`405` 是没被接受；而 200 + HTML 是本应用对
 *   **不存在的路径**返回的 404 页——所以「不是 405」单独不能当证据，
 *   否则会把「路由被删了」读成「路由接受 GET」。未知一律不算通过。
 *
 * 核对的路径直接读 `vercel.json` 的 `crons`，与静态门禁同源：查的是「本该被调度的那些路径」。
 * 读不到或读成空 ⇒ 红（失败封闭：没有可核对的调度不等于通过）。
 */
function readScheduledPaths() {
  const configPath = path.join(__dirname, "..", "vercel.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const crons = Array.isArray(parsed.crons) ? parsed.crons : [];
    // `/api/health` 不在本步核对：它是保活端点而不是 worker，且第 1 步已经用 **GET**
    // 打过它并断言 200 + JSON——再打一次不增加任何证据，只会把本步与 health 的重试计数耦上。
    const paths = crons
      .map((entry) => entry && entry.path)
      .filter((p) => typeof p === "string" && p !== "/api/health");
    return [...new Set(paths)];
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkCronTriggerMethod(baseUrl, options) {
  const scheduled = readScheduledPaths();
  if (!Array.isArray(scheduled)) {
    return result(
      "cron-trigger-method",
      false,
      `无法读取 vercel.json 的 crons：${scheduled.error}`,
      null,
    );
  }
  if (scheduled.length === 0) {
    return result(
      "cron-trigger-method",
      false,
      "vercel.json 里没有任何 crons 条目（没有可核对的调度 = 失败封闭，不等于通过）",
      null,
    );
  }

  const offenders = [];
  const statuses = {};
  for (const pathname of [...scheduled].sort()) {
    const response = await request(
      options.fetchImpl,
      joinUrl(baseUrl, pathname),
      { method: "GET", redirect: "manual" },
      options.timeoutMs,
    );
    await response.text().catch(() => "");
    const contentType = response.headers.get("content-type") ?? "";
    statuses[pathname] = response.status;
    const accepted =
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 200 &&
        response.status < 300 &&
        contentType.includes("application/json"));
    if (!accepted) {
      offenders.push(`${pathname}: HTTP ${response.status} (${contentType || "无 content-type"})`);
    }
  }

  return result(
    "cron-trigger-method",
    offenders.length === 0,
    offenders.length === 0
      ? `${scheduled.length} 条调度路径都接受 GET（Vercel Cron 的触发方法），无 405`
      : `GET 未被接受，调度器触发不到业务代码：${offenders.join("; ")}`,
    null,
    { statuses },
  );
}

async function runProductionSmoke(baseUrlValue, options = {}) {
  const baseUrl = baseUrlValue instanceof URL ? baseUrlValue : parseBaseUrl(baseUrlValue);
  const config = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    expectedVersion: options.expectedVersion,
    expectedCommit: options.expectedCommit,
    healthAttempts: options.healthAttempts ?? DEFAULT_ATTEMPTS,
    healthRetryDelayMs: options.healthRetryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    sleepImpl: options.sleepImpl,
  };
  if (typeof config.fetchImpl !== "function") throw new Error("fetch is not available");
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
    throw new Error("timeoutMs must be a positive number");

  const checks = [];
  const runners = [
    checkHealth,
    checkLiveness,
    checkHomepage,
    checkStaticAsset,
    checkSecurityHeaders,
    checkUnauthorizedDashboard,
    checkWebhookRejection,
    checkCronTriggerMethod,
  ];
  for (const runner of runners) {
    try {
      checks.push(await runner(baseUrl, config));
    } catch (error) {
      checks.push(
        result(runner.name, false, error instanceof Error ? error.message : String(error), null),
      );
    }
  }

  return summarizeReport(checks, config, baseUrl);
}

/**
 * 证据文件的顶层字段。
 *
 * `commit` 是「生产此刻在跑哪个构建」——没有它，6/6 只能证明某个 0.11.0 构建是好的，
 * 证明不了它是被验证过的那一个。
 */
function summarizeReport(checks, config, baseUrl) {
  const health = checks.find((check) => check.name === "health");
  return {
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl.origin,
    expectedVersion: config.expectedVersion ?? null,
    expectedCommit: config.expectedCommit ?? null,
    commit: health?.commit ?? null,
    commitReported: health?.commitReported === true,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    console.error(
      "Usage: pnpm smoke:production -- https://example.com [--expected-version 0.6.0] [--expected-commit 2b52ce1] [--output smoke.json]",
    );
    return 2;
  }

  let report;
  try {
    report = await runProductionSmoke(options.url, {
      expectedVersion: options.expectedVersion,
      expectedCommit: options.expectedCommit,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const passed = report.checks.filter((check) => check.passed).length;
  console.log(
    `${report.passed ? "✅" : "❌"} production smoke: ${passed}/${report.checks.length} passed (${report.baseUrl})`,
  );
  for (const check of report.checks) {
    console.log(`${check.passed ? "  ✅" : "  ❌"} ${check.name}: ${check.detail}`);
  }

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Evidence written to ${outputPath}`);
  }

  return report.passed ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  checkHealth,
  checkLiveness,
  checkHomepage,
  checkSecurityHeaders,
  checkStaticAsset,
  checkUnauthorizedDashboard,
  checkWebhookRejection,
  checkCronTriggerMethod,
  commitLabel,
  describeEvidenceCommit,
  joinUrl,
  main,
  parseArgs,
  parseBaseUrl,
  readScheduledPaths,
  runProductionSmoke,
};
