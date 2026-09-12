import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const health = require("../../scripts/lib/health-probe.js") as {
  isHealthyResponse: (status: number, body: unknown) => boolean;
  probeHealth: (
    url: string | URL,
    options: {
      fetchImpl: typeof fetch;
      timeoutMs?: number;
      attempts?: number;
      retryDelayMs?: number;
      sleepImpl?: (ms: number) => Promise<void>;
      responseInit?: RequestInit;
      validate?: (result: { status: number; body: unknown; headers: Headers | null }) => boolean;
      onRetry?: (event: unknown) => void;
    },
  ) => Promise<{
    healthy: boolean;
    status: number;
    body: unknown;
    headers: Headers | null;
    error: string | null;
    attempts: number;
  }>;
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("health probe retry", () => {
  it("retries a transient 503 and succeeds on the next attempt", async () => {
    const responses = [
      jsonResponse({ status: "degraded", ready: false }, 503),
      jsonResponse({ status: "ok", ready: true }, 200),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() ?? jsonResponse({}, 500));
    const sleepImpl = vi.fn(async () => undefined);
    const onRetry = vi.fn();

    const result = await health.probeHealth("https://example.com/api/health", {
      fetchImpl: fetchImpl as typeof fetch,
      attempts: 3,
      retryDelayMs: 25,
      sleepImpl,
      onRetry,
    });

    expect(result).toMatchObject({ healthy: true, status: 200, attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(25);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("retries network failures and returns the final error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const sleepImpl = vi.fn(async () => undefined);

    const result = await health.probeHealth("https://example.com/api/health", {
      fetchImpl: fetchImpl as typeof fetch,
      attempts: 3,
      retryDelayMs: 0,
      sleepImpl,
    });

    expect(result).toMatchObject({ healthy: false, status: 0, error: "fetch failed", attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a permanent 404 configuration error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "not found" }, 404));

    const result = await health.probeHealth("https://example.com/api/health", {
      fetchImpl: fetchImpl as typeof fetch,
      attempts: 3,
      retryDelayMs: 0,
    });

    expect(result).toMatchObject({ healthy: false, status: 404, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps backward compatibility with pre-ready deployments", () => {
    expect(health.isHealthyResponse(200, { status: "ok" })).toBe(true);
    expect(health.isHealthyResponse(200, { status: "ok", ready: false })).toBe(false);
    expect(health.isHealthyResponse(503, { status: "degraded", ready: false })).toBe(false);
  });

  it("supports response-aware validation and exposes headers", async () => {
    const responses = [
      jsonResponse({ status: "ok", ready: true, version: "0.5.0" }, 200, { "x-request-id": "old" }),
      jsonResponse({ status: "ok", ready: true, version: "0.6.0" }, 200, { "x-request-id": "new" }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() ?? jsonResponse({}, 500));

    const result = await health.probeHealth("https://example.com/api/health", {
      fetchImpl: fetchImpl as typeof fetch,
      attempts: 2,
      retryDelayMs: 0,
      validate: (candidate) =>
        (candidate.body as { version?: string } | null)?.version === "0.6.0" &&
        candidate.headers?.get("x-request-id") === "new",
    });

    expect(result).toMatchObject({ healthy: true, attempts: 2 });
    expect(result.headers?.get("x-request-id")).toBe("new");
  });

  it("rejects an invalid attempt count before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      health.probeHealth("https://example.com/api/health", { fetchImpl, attempts: 0 }),
    ).rejects.toThrow(/positive integer/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
