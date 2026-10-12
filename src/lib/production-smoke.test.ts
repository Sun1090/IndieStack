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
  checkCronTriggerMethod: (
    baseUrl: URL,
    options: { fetchImpl: typeof fetch; timeoutMs?: number },
  ) => Promise<{ name: string; passed: boolean; detail: string; statuses: Record<string, number> }>;
  readScheduledPaths: () => string[] | { error: string };
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
      if (url.pathname === "/api/health/live") {
        return jsonResponse(
          { status: "ok", timestamp: "2026-10-05T00:00:00.000Z" },
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
      // Vercel Cron 用 GET 触发、不带凭据时路由答 401（方法被接受）。替身必须照这个形状回，
      // 否则「全套通过」那条用例会在新加的第 8 步上假红。
      if (url.pathname.startsWith("/api/cron/") || url.pathname === "/api/ops/supabase-restore") {
        expect(init?.method).toBe("GET");
        return jsonResponse({ error: "Unauthorized" }, 401, secureHeaders());
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
      "liveness",
      "homepage",
      "static-asset",
      "security-headers",
      "anonymous-dashboard",
      "webhook-signature-rejection",
      "cron-trigger-method",
    ]);
  });

  /** 只让 `/api/health` 返回给定 body，其余端点全部正常的 fetch 替身。 */
  function healthOnlyFetch(healthBody: unknown) {
    return vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/health") {
        return jsonResponse(healthBody, 200, secureHeaders({ "cache-control": "no-store" }));
      }
      if (url.pathname === "/api/health/live") {
        return jsonResponse(
          { status: "ok", timestamp: "2026-10-05T00:00:00.000Z" },
          200,
          secureHeaders({ "cache-control": "no-store" }),
        );
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
      // cron 路径按 Vercel Cron 的真实形状回 401 JSON（GET 被接受、只是没带凭据）。
      // 不加这一支，第 8 步会落到下面的 HTML 替身上并把「commit 身份」那两条用例假红。
      if (url.pathname.startsWith("/api/cron/") || url.pathname === "/api/ops/supabase-restore") {
        return jsonResponse({ error: "Unauthorized" }, 401, secureHeaders());
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
      // cron 路径一律答 405：这正是 2026-10-10 那次线上故障的真实形状（只导出 POST 时
      // Next.js 的实际响应），第 8 步必须因此报红并点出是哪条路径。
      if (url.pathname.startsWith("/api/cron/")) {
        return new Response(null, { status: 405, headers: { allow: "POST" } });
      }
      return htmlResponse("not found", 404);
    });

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: fetchImpl as typeof fetch,
      expectedVersion: "0.6.0",
      healthRetryDelayMs: 0,
    });
    expect(report.passed).toBe(false);
    expect(report.checks.every((check) => !check.passed)).toBe(true);
    expect(report.checks).toHaveLength(8);
    const cron = report.checks.find((check) => check.name === "cron-trigger-method")!;
    expect(cron.detail).toContain("405");
    expect(cron.detail).toContain("/api/cron/digest");
  });

  /**
   * 第 8 步的判定口径里最容易被糊过去的两支。
   *
   * 「不是 405」绝不能单独当成证据：本应用对**不存在的路径**返回 200 + HTML 404 页，
   * 所以只看状态码会把「路由被人删了」读成「路由接受 GET」——那正是这条检查要防的事故，
   * 只是换了一种表现。未知状态码同样不算通过。
   */
  it("cron 路径返回 200 + HTML（路由被删）与未知状态码都判红", async () => {
    const build = (status: number, contentType: string) =>
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.startsWith("/api/cron/") || url.pathname === "/api/ops/supabase-restore") {
          return new Response("body", { status, headers: { "content-type": contentType } });
        }
        if (url.pathname === "/api/health") {
          return jsonResponse(
            { status: "ok", ready: true, version: "0.12.0" },
            200,
            secureHeaders({ "cache-control": "no-store" }),
          );
        }
        return htmlResponse('<!doctype html><main id="main-content">x</main>', 200, secureHeaders());
      });

    const html = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: build(200, "text/html; charset=utf-8") as unknown as typeof fetch,
      healthRetryDelayMs: 0,
    });
    const htmlCheck = html.checks.find((c) => c.name === "cron-trigger-method")!;
    expect(htmlCheck.passed).toBe(false);
    expect(htmlCheck.detail).toContain("text/html");

    const unknown = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: build(418, "application/json") as unknown as typeof fetch,
      healthRetryDelayMs: 0,
    });
    expect(unknown.checks.find((c) => c.name === "cron-trigger-method")!.passed).toBe(false);

    // 反向钉：401 JSON 必须是绿——它是「方法被接受、只是没带凭据」的形状，
    // 若把它判红，这条检查会在每次正常部署上假红，然后被人关掉。
    const ok = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: build(401, "application/json") as unknown as typeof fetch,
      healthRetryDelayMs: 0,
    });
    expect(ok.checks.find((c) => c.name === "cron-trigger-method")!.passed).toBe(true);
  });

  /**
   * **302 必须判红，且不能为了「让 preview 也绿」把 3xx 加进放行名单。**
   * 2026-10-10 在 PR #236 的 preview 部署上实测：开着 Vercel Deployment Protection 时，
   * 每个请求（连一条**故意编造的假 cron 路径**也一样）都被 302 到
   * `vercel.com/sso-api`。此时**应用的行为一次都没被观察到**——
   * 「证明不了」记成「通过」就是假绿，而这条检查存在的理由恰恰是假绿。
   */
  it("受部署保护（所有路径 302 到 SSO）时判红，而不是当成通过", async () => {
    const protectedFetch = vi.fn(async (input: string | URL | Request) =>
      new Response("redirecting", {
        status: 302,
        headers: {
          location: `https://vercel.com/sso-api?url=${encodeURIComponent(String(input))}`,
          "content-type": "text/plain",
        },
      }),
    ) as unknown as typeof fetch;

    const report = await smoke.runProductionSmoke("https://example.com", {
      fetchImpl: protectedFetch,
      healthRetryDelayMs: 0,
    });
    const cronCheck = report.checks.find((c) => c.name === "cron-trigger-method")!;
    expect(cronCheck.passed).toBe(false);
    // 405 不在读数里：红的原因不是「方法没导出」，而是「根本没问到应用」——
    // detail 要能让人分辨这两件事，否则会把受保护的 preview 读成一次生产故障。
    expect(cronCheck.detail).not.toContain("405");
    expect(cronCheck.detail).toContain("302");
  });

  it("核对的路径来自 vercel.json 的 crons，且不含已由第 1 步覆盖的 /api/health", () => {
    const scheduled = smoke.readScheduledPaths();
    expect(scheduled).toContain("/api/cron/digest");
    expect(scheduled).toContain("/api/cron/retention");
    expect(scheduled).toContain("/api/cron/push-retry");
    expect(scheduled).not.toContain("/api/health");
  });
});
