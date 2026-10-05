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
  if (!/^https?:$/.test(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== "/api/health") parsed.pathname = "/api/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

/**
 * 把逐依赖事实与读数时间打出来。
 *
 * **为什么成功时也要打印**：2026-10-05 有人在文档里写下「生产没配 Sentry / 没配 Supabase」，
 * 其中后半句是**错的**——错因就是这些事实只存在于某次现场读数里，
 * 而本命令成功时只印一行 "passed"，事后谁也没法复核。
 * 成本是几行输出，收益是**每份文档里的生产实况都能用一条命令刷新**，
 * 而不是靠记忆。
 *
 * **刻意不读 secret 值**：这里只打印「配没配」与状态，不碰任何凭据内容。
 */
function printDependencyFacts(body) {
  if (!body || typeof body !== "object") return;
  console.log(`   读数时间（UTC）：${new Date().toISOString()}`);
  console.log(
    `   version=${body.version ?? "unknown"} commit=${body.commit ?? "not-reported"} ready=${body.ready}`,
  );
  const checks = body.checks;
  if (!checks || typeof checks !== "object") return;
  for (const [name, check] of Object.entries(checks)) {
    const reachable = check && "reachable" in check ? ` reachable=${check.reachable}` : "";
    console.log(
      `   - ${name}: required=${check.required} configured=${check.configured}` +
        ` status=${check.status}${reachable}`,
    );
  }
  console.log(`   allConfigured=${body.allConfigured} degraded=${body.degraded}`);
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
  printDependencyFacts(result.body);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { main, parseHealthUrl };
