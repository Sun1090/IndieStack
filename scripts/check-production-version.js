#!/usr/bin/env node
/**
 * Scheduled production version drift check for IndieStack.
 *
 * Usage:
 *   node scripts/check-production-version.js --base-url https://example.com
 *
 * Reads the expected version from package.json, then writes full production smoke
 * evidence to production-smoke.json. This is intentionally narrow for scheduled CI:
 * it catches stale production deployments before a release is mistaken for current.
 *
 * The evidence also records the commit production is actually running (`/api/health`'s
 * `commit`), but the scheduled job does not assert it — see the comment in main().
 */
const fs = require("fs");
const path = require("path");
const { DEFAULT_TIMEOUT_MS, runProductionSmoke } = require("./production-smoke");

const DEFAULT_BASE_URL = "https://indie-stack-theta.vercel.app";
const DEFAULT_OUTPUT = "production-smoke.json";

/** `--flag value` 与 `--flag=value` 共用的取值表（查表走 `Object.hasOwn`，避免原型属性命中）。 */
const CLI_FLAGS = {
  "--base-url": "baseUrl",
  "--expected-commit": "expectedCommit",
  "--output": "output",
  "--timeout-ms": "timeoutMs",
};

function parseArgs(argv) {
  const options = {
    baseUrl: undefined,
    output: DEFAULT_OUTPUT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    expectedCommit: process.env.EXPECTED_APP_COMMIT || undefined,
  };
  let index = 0;

  const readValue = (flag) => {
    index += 1;
    const value = argv[index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    return value;
  };

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (!Object.hasOwn(CLI_FLAGS, name)) continue;
    const raw = equals === -1 ? readValue(name) : arg.slice(equals + 1);
    options[CLI_FLAGS[name]] = name === "--timeout-ms" ? Number(raw) : raw;
  }

  if (!options.baseUrl || options.baseUrl.startsWith("--")) {
    throw new Error("--base-url requires a value");
  }
  if (!options.output || options.output.startsWith("--")) {
    throw new Error("--output requires a value");
  }
  if (options.expectedCommit && options.expectedCommit.trim().length < 7) {
    throw new Error("--expected-commit must be at least 7 characters (a short SHA)");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  return options;
}

function readExpectedVersion() {
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (!pkg.version || typeof pkg.version !== "string") {
    throw new Error("package.json version is missing or not a string");
  }
  return pkg.version;
}

async function main() {
  let options;
  let expectedVersion;
  try {
    options = parseArgs(process.argv.slice(2));
    expectedVersion = readExpectedVersion();
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  let report;
  try {
    report = await runProductionSmoke(baseUrl, {
      expectedVersion,
      // 默认为空：本脚本每日跑一次，而「生产的 commit 落后于 main 的 HEAD」在两次部署之间
      // 是常态（文档改动、排队中的构建），把它变成硬性断言只会让定时作业天天红在无关的事上。
      // 发布时的手动 smoke 才需要钉住 commit——那一刻的期望 SHA 是人显式提供的。
      expectedCommit: options.expectedCommit,
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  const passed = report.checks.filter((check) => check.passed).length;
  const observedCommit = report.commit ?? "unknown";
  console.log(
    `${report.passed ? "✅" : "❌"} production version drift check: ${passed}/${report.checks.length} passed, expected version ${expectedVersion}, deployed commit ${observedCommit}`,
  );
  for (const check of report.checks) {
    console.log(`${check.passed ? "  ✅" : "  ❌"} ${check.name}: ${check.detail}`);
  }
  console.log(`Evidence written to ${outputPath}`);
  return report.passed ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_OUTPUT,
  main,
  parseArgs,
  readExpectedVersion,
};
