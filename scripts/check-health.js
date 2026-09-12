#!/usr/bin/env node
/**
 * Probe a deployed IndieStack health endpoint.
 * Usage: pnpm health:check -- https://example.com/api/health
 */

const { DEFAULT_ATTEMPTS, DEFAULT_RETRY_DELAY_MS, probeHealth } = require("./lib/health-probe");

function parseHealthUrl(value) {
  if (!value) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return /^https?:$/.test(parsed.protocol) ? parsed : null;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const url = args[0] || process.env.HEALTHCHECK_URL;
  if (!url) {
    console.error("Usage: pnpm health:check -- https://example.com/api/health");
    return 2;
  }

  const parsed = parseHealthUrl(url);
  if (!parsed) {
    console.error("❌ Health URL must use http or https");
    return 2;
  }

  const result = await probeHealth(parsed, {
    attempts: DEFAULT_ATTEMPTS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    onRetry: ({ nextAttempt, attempts, result: failed }) => {
      const detail = failed.error || `HTTP ${failed.status}`;
      console.error(
        `⚠️ Health check attempt ${nextAttempt - 1}/${attempts} failed (${detail}); retrying`,
      );
    },
  });

  if (!result.healthy) {
    const detail = result.error || `HTTP ${result.status}`;
    console.error(`❌ Health check failed after ${result.attempts} attempt(s): ${detail}`);
    if (result.body) console.error(JSON.stringify(result.body));
    return 1;
  }

  console.log(
    `✅ Health check passed: ${parsed.origin}${parsed.pathname} (attempt ${result.attempts})`,
  );
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { main, parseHealthUrl };
