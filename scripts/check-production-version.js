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
 */
const fs = require("fs");
const path = require("path");
const { DEFAULT_TIMEOUT_MS, runProductionSmoke } = require("./production-smoke");

const DEFAULT_BASE_URL = "https://indie-stack-theta.vercel.app";
const DEFAULT_OUTPUT = "production-smoke.json";

function parseArgs(argv) {
  const options = { baseUrl: undefined, output: DEFAULT_OUTPUT, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      index += 1;
      options.baseUrl = argv[index];
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--output") {
      index += 1;
      options.output = argv[index];
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--timeout-ms") {
      index += 1;
      options.timeoutMs = Number(argv[index]);
    } else if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    }
  }

  if (!options.baseUrl || options.baseUrl.startsWith("--")) {
    throw new Error("--base-url requires a value");
  }
  if (!options.output || options.output.startsWith("--")) {
    throw new Error("--output requires a value");
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
  console.log(
    `${report.passed ? "✅" : "❌"} production version drift check: ${passed}/${report.checks.length} passed, expected version ${expectedVersion}`,
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
