import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const smoke = require("../../scripts/production-smoke.js") as {
  parseBaseUrl: (value: string) => URL;
  parseArgs: (argv: string[]) => {
    url?: string;
    expectedVersion?: string;
    expectedCommit?: string;
    output?: string;
    timeoutMs: number;
  };
  runProductionSmoke: (
    url: string,
    options: {
      fetchImpl: typeof fetch;
      expectedVersion?: string;
      expectedCommit?: string;
      timeoutMs?: number;
      healthAttempts?: number;
      healthRetryDelayMs?: number;
      sleepImpl?: (ms: number) => Promise<void>;
    },
  ) => Promise<{
    passed: boolean;
    commit: string | null;
    commitReported: boolean;
    expectedCommit: string | null;
    checks: Array<{ name: string; passed: boolean; detail: string; status: number | null }>;
  }>;
  describeEvidenceCommit: (evidence: {
    commit?: string | null;
    commitReported?: boolean;
  }) => string;
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
    expect(() => smoke.parseArgs(["--output", "--expected-version=0.6.0"])).toThrow(
      /requires a value/,
    );
    expect(() => smoke.parseArgs(["--expected-version="])).toThrow(/non-empty/);
  });

  it("passes all side-effect-free checks", async () => {
    let healthCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        healthCalls += 1;
        if (healthCalls === 1) {
          return jsonResponse(
            { status: "degraded", ready: false, version: "0.6.0" },
            503,
            secureHeaders({ "cache-control": "no-store" }),
          );
        }
        return jsonResponse(
          { status: "ok", ready: true, version: "0.6.0" },
          200,
          secureHeaders({ "cache-control": "no-store" }),
        );
      }
      if (url.pathname === "/icon.svg") {
        return new Response("<svg></svg>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        });
      }
      if (url.pathname === "/dashboard") {
        return new Response(null, {
          status: 307,
          headers: { location: "/auth/login?redirect=%2Fdashboard" },
        });
      }
      if (url.pathname === "/api/webhooks/stripe") {
        expect(init?.method).toBe("POST");
        return jsonResponse(
          { error: "Missing signature" },
          400,
          secureHeaders({ "cache-control": "no-store" }),
        );
      }
      return htmlResponse(
        '<!doctype html><main id="main-content">IndieStack</main>',
        200,
        secureHeaders(),
      );
    });

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: fetchImpl as typeof fetch,
      expectedVersion: "0.6.0",
      healthRetryDelayMs: 0,
    });
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(healthCalls).toBe(2);
    expect(report.checks.map((check) => check.name)).toEqual([
      "health",
      "homepage",
      "static-asset",
      "security-headers",
      "anonymous-dashboard",
      "webhook-signature-rejection",
    ]);
  });

  /** 只让 `/api/health` 返回给定 body，其余端点全部正常的 fetch 替身。 */
  function healthOnlyFetch(healthBody: unknown) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        return jsonResponse(healthBody, 200, secureHeaders({ "cache-control": "no-store" }));
      }
      if (url.pathname === "/icon.svg") {
        return new Response("<svg></svg>", { status: 200, headers: { "content-type": "image/svg+xml" } });
      }
      if (url.pathname === "/dashboard") {
        return new Response(null, { status: 307, headers: { location: "/auth/login?redirect=%2Fdashboard" } });
      }
      if (url.pathname === "/api/webhooks/stripe") {
        return jsonResponse({ error: "Missing signature" }, 400, secureHeaders({ "cache-control": "no-store" }));
      }
      return htmlResponse('<!doctype html><main id="main-content">IndieStack</main>', 200, secureHeaders());
    });
  }

  async function runWithCommit(healthBody: unknown, expectedCommit?: string) {
    return smoke.runProductionSmoke("https://example.com", {
      fetchImpl: healthOnlyFetch(healthBody) as unknown as typeof fetch,
      expectedCommit,
      healthRetryDelayMs: 0,
    });
  }

  it("records and asserts the commit production is actually running", async () => {
    const sha = "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d";
    const ok = await runWithCommit({ status: "ok", ready: true, version: "0.11.0", commit: sha });
    expect(ok.passed).toBe(true);
    expect(ok.commit).toBe(sha);
    expect(ok.checks[0].detail).toContain("commit=a322a4e");

    // 发布记录里通常只写短 SHA，前缀相等即视为同一次构建。
    const short = await runWithCommit({ status: "ok", ready: true, version: "0.11.0", commit: sha }, "a322a4e");
    expect(short.passed).toBe(true);

    const mismatch = await runWithCommit({ status: "ok", ready: true, version: "0.11.0", commit: sha }, "23a2677");
    expect(mismatch.passed).toBe(false);
    expect(mismatch.checks[0].detail).toContain("commit=a322a4e, expected=23a2677");

    // 早于本字段的构建：无法证明 commit 相同就是没证明，不得当成通过。
    const unknown = await runWithCommit({ status: "ok", ready: true, version: "0.11.0" }, "a322a4e");
    expect(unknown.passed).toBe(false);
    expect(unknown.checks[0].detail).toContain("commit=not-reported, expected=a322a4e");
    expect(unknown.commitReported).toBe(false);

    // 没有期望值时只记录，不新增失败面（定时漂移检查走的就是这条路）。
    const unasserted = await runWithCommit({ status: "ok", ready: true, version: "0.11.0" });
    expect(unasserted.passed).toBe(true);
    expect(unasserted.commit).toBeNull();
    expect(unasserted.expectedCommit).toBeNull();
  });

  it("把「没上报 commit」的两种原因读成两件事", async () => {
    // 键根本不在 = 生产那份构建早于上报 commit 的改动（部署滞后）
    const stale = await runWithCommit({ status: "ok", ready: true, version: "0.11.0" });
    expect(stale.checks[0].detail).toContain("commit=not-reported");
    expect(stale.commitReported).toBe(false);

    // 键在而值为 null = 构建时没拿到 git 变量（平台配置），不是旧构建
    const noEnv = await runWithCommit({
      status: "ok",
      ready: true,
      version: "0.11.0",
      commit: null,
    });
    expect(noEnv.passed).toBe(true);
    expect(noEnv.checks[0].detail).toContain("commit=no-build-env");
    expect(noEnv.commitReported).toBe(true);
    expect(noEnv.commit).toBeNull();

    // 空串同样读成「没拿到变量」，而不是当成一个合法 SHA
    const blank = await runWithCommit({
      status: "ok",
      ready: true,
      version: "0.11.0",
      commit: "   ",
    });
    expect(blank.checks[0].detail).toContain("commit=no-build-env");

    const sha = await runWithCommit({
      status: "ok",
      ready: true,
      version: "0.11.0",
      commit: "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d",
    });
    expect(sha.checks[0].detail).toContain("commit=a322a4e");
    expect(sha.commitReported).toBe(true);

    // 证据文件那一侧的读法：缺 `commitReported` 这一格的旧产物必须读成 not-reported
    expect(smoke.describeEvidenceCommit({ commit: null, commitReported: true })).toBe("no-build-env");
    expect(smoke.describeEvidenceCommit({ commit: "a322a4ed6a", commitReported: true })).toBe(
      "a322a4e",
    );
    expect(smoke.describeEvidenceCommit({ commit: null, commitReported: false })).toBe(
      "not-reported",
    );
    expect(smoke.describeEvidenceCommit({ commit: null })).toBe("not-reported");
  });

  it("rejects an expected commit short enough to match anything", () => {
    expect(() => smoke.parseArgs(["https://example.com", "--expected-commit", "abc"])).toThrow(
      /at least 7 characters/,
    );
    expect(smoke.parseArgs(["https://example.com", "--expected-commit=a322a4ed6a"])).toMatchObject({
      expectedCommit: "a322a4ed6a",
    });
  });

  it("reports individual failures while continuing the suite", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        return jsonResponse({ status: "degraded", ready: false, version: "0.5.0" }, 503);
      }
      if (url.pathname === "/dashboard") return new Response(null, { status: 200 });
      if (url.pathname === "/api/webhooks/stripe")
        return jsonResponse({ error: "unexpected" }, 500);
      return htmlResponse("not found", 404);
    });

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: fetchImpl as typeof fetch,
      expectedVersion: "0.6.0",
      healthRetryDelayMs: 0,
    });
    expect(report.passed).toBe(false);
    expect(report.checks.every((check) => !check.passed)).toBe(true);
    expect(report.checks).toHaveLength(6);
  });
});
