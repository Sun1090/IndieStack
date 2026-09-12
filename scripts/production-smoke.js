#!/usr/bin/env node
/**
 * Side-effect-free production smoke checks for IndieStack.
 *
 * Usage:
 *   pnpm smoke:production -- https://indie-stack-theta.vercel.app
 *   pnpm smoke:production -- https://example.com --expected-version 0.6.0 --output smoke.json
 *
 * The suite only performs GET requests and one intentionally invalid webhook POST.
 * It never follows redirects for the protected dashboard check and never sends credentials.
 */
const fs = require("fs");
const path = require("path");
const { DEFAULT_ATTEMPTS, DEFAULT_RETRY_DELAY_MS, probeHealth } = require("./lib/health-probe");

const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    url: undefined,
    expectedVersion: undefined,
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
    if (arg === "--expected-version") options.expectedVersion = readValue(arg);
    else if (arg.startsWith("--expected-version="))
      options.expectedVersion = arg.slice("--expected-version=".length);
    else if (arg === "--output") options.output = readValue(arg);
    else if (arg.startsWith("--output=")) options.output = arg.slice("--output=".length);
    else if (arg === "--timeout-ms") options.timeoutMs = Number(readValue(arg));
    else if (arg.startsWith("--timeout-ms="))
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else if (!arg.startsWith("-") && !options.url) options.url = arg;
  }

  if (options.expectedVersion === "")
    throw new Error("--expected-version requires a non-empty value");
  if (options.output === "") throw new Error("--output requires a non-empty value");

  options.url ??= process.env.PRODUCTION_URL;
  if (options.expectedVersion === undefined)
    options.expectedVersion = process.env.EXPECTED_APP_VERSION;
  return options;
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

function healthFailureDetail(response, body, versionMatches, expectedVersion) {
  const version = body?.version ?? "missing";
  const checks = [
    [`HTTP ${response.status}`, response.status === 200],
    [`status=${body?.status ?? "invalid"}`, body?.status === "ok"],
    [`ready=${String(body?.ready)}`, body?.ready === true],
    ["cache-control", headerIncludes(response.headers, "cache-control", "no-store")],
    ["x-request-id", Boolean(response.headers.get("x-request-id"))],
    [`version=${version}, expected=${expectedVersion ?? "unknown"}`, versionMatches],
  ];
  const failed = checks
    .filter(([, passed]) => !passed)
    .map(([label, passed]) => (passed ? null : label));
  return failed.filter((label) => label !== null).join(", ") || "invalid health response";
}

async function checkHealth(baseUrl, options) {
  const expectedVersion = options.expectedVersion;
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
        versionMatches
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
  const passed = probeResult.healthy;
  const detail = passed
    ? `HTTP 200, status=ok, ready=true, version=${body.version}${probeResult.attempts > 1 ? ` (attempt ${probeResult.attempts})` : ""}`
    : healthFailureDetail(response, body, versionMatches, options.expectedVersion);
  return result("health", passed, detail, response.status, {
    version: body?.version ?? null,
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

async function runProductionSmoke(baseUrlValue, options = {}) {
  const baseUrl = baseUrlValue instanceof URL ? baseUrlValue : parseBaseUrl(baseUrlValue);
  const config = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    expectedVersion: options.expectedVersion,
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
    checkHomepage,
    checkStaticAsset,
    checkSecurityHeaders,
    checkUnauthorizedDashboard,
    checkWebhookRejection,
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

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl.origin,
    expectedVersion: config.expectedVersion ?? null,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.url) {
    console.error(
      "Usage: pnpm smoke:production -- https://example.com [--expected-version 0.6.0] [--output smoke.json]",
    );
    return 2;
  }

  let report;
  try {
    report = await runProductionSmoke(options.url, {
      expectedVersion: options.expectedVersion,
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
  checkHomepage,
  checkSecurityHeaders,
  checkStaticAsset,
  checkUnauthorizedDashboard,
  checkWebhookRejection,
  joinUrl,
  main,
  parseArgs,
  parseBaseUrl,
  runProductionSmoke,
};
