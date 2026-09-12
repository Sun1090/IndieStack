import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const smoke = require("../../scripts/production-smoke.js") as {
  parseBaseUrl: (value: string) => URL;
  parseArgs: (argv: string[]) => { url?: string; expectedVersion?: string; output?: string; timeoutMs: number };
  runProductionSmoke: (
    url: string,
    options: { fetchImpl: typeof fetch; expectedVersion?: string; timeoutMs?: number },
  ) => Promise<{
    passed: boolean;
    checks: Array<{ name: string; passed: boolean; detail: string; status: number | null }>;
  }>;
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html", ...headers } });
}

function secureHeaders(extra: Record<string, string> = {}) {
  return {
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=()",
    "x-request-id": "request-1",
    ...extra,
  };
}

describe("production smoke CLI", () => {
  it("normalizes URLs and rejects credentials", () => {
    expect(smoke.parseBaseUrl("https://example.com/path/").origin).toBe("https://example.com");
    expect(() => smoke.parseBaseUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(() => smoke.parseBaseUrl("ftp://example.com")).toThrow(/http/);
  });

  it("parses documented flags", () => {
    expect(
      smoke.parseArgs([
        "--",
        "https://example.com",
        "--expected-version=0.6.0",
        "--output",
        "smoke.json",
        "--timeout-ms",
        "5000",
      ]),
    ).toMatchObject({
      url: "https://example.com",
      expectedVersion: "0.6.0",
      output: "smoke.json",
      timeoutMs: 5000,
    });
  });

  it("rejects flags without safe non-empty values", () => {
    expect(() => smoke.parseArgs(["--expected-version"])).toThrow(/requires a value/);
    expect(() => smoke.parseArgs(["--output", "--expected-version=0.6.0"])).toThrow(/requires a value/);
    expect(() => smoke.parseArgs(["--expected-version="])).toThrow(/non-empty/);
  });

  it("passes all side-effect-free checks", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        return jsonResponse(
          { status: "ok", ready: true, version: "0.6.0" },
          200,
          secureHeaders({ "cache-control": "no-store" }),
        );
      }
      if (url.pathname === "/icon.svg") {
        return new Response("<svg></svg>", { status: 200, headers: { "content-type": "image/svg+xml" } });
      }
      if (url.pathname === "/dashboard") {
        return new Response(null, {
          status: 307,
          headers: { location: "/auth/login?redirect=%2Fdashboard" },
        });
      }
      if (url.pathname === "/api/webhooks/stripe") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ error: "Missing signature" }, 400, secureHeaders({ "cache-control": "no-store" }));
      }
      return htmlResponse('<!doctype html><main id="main-content">IndieStack</main>', 200, secureHeaders());
    });

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: fetchImpl as typeof fetch,
      expectedVersion: "0.6.0",
    });
    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => check.name)).toEqual([
      "health",
      "homepage",
      "static-asset",
      "security-headers",
      "anonymous-dashboard",
      "webhook-signature-rejection",
    ]);
  });

  it("reports individual failures while continuing the suite", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        return jsonResponse({ status: "degraded", ready: false, version: "0.5.0" }, 503);
      }
      if (url.pathname === "/dashboard") return new Response(null, { status: 200 });
      if (url.pathname === "/api/webhooks/stripe") return jsonResponse({ error: "unexpected" }, 500);
      return htmlResponse("not found", 404);
    });

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: fetchImpl as typeof fetch,
      expectedVersion: "0.6.0",
    });
    expect(report.passed).toBe(false);
    expect(report.checks.every((check) => !check.passed)).toBe(true);
    expect(report.checks).toHaveLength(6);
  });
});
