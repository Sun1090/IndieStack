#!/usr/bin/env node
/**
 * Probe a deployed IndieStack health endpoint.
 * Usage: pnpm health:check -- https://example.com/api/health
 */

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const url = args[0] || process.env.HEALTHCHECK_URL;
  if (!url) {
    console.error("Usage: pnpm health:check -- https://example.com/api/health");
    return 2;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`❌ Invalid health URL: ${url}`);
    return 2;
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    console.error("❌ Health URL must use http or https");
    return 2;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(parsed, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    // 向后兼容：v0.6.0 起 body 带 ready 字段；更早的部署只有 status，
    // 只要没显式 ready:false 就算健康，避免保活探测在版本切换期误报。
    const healthy =
      response.status === 200 && body?.status === "ok" && body?.ready !== false;

    if (!healthy) {
      console.error(`❌ Health check failed: HTTP ${response.status}`);
      if (body) console.error(JSON.stringify(body));
      return 1;
    }

    console.log(`✅ Health check passed: ${parsed.origin}${parsed.pathname}`);
    return 0;
  } catch (error) {
    console.error(
      `❌ Health check request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    clearTimeout(timeout);
  }
}

main().then((code) => process.exit(code));
