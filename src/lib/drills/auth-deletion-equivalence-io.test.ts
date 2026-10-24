/**
 * 等价性实验 IO 层的单测：deps 全注入（docker / fetch 都换成桩），
 * 因此这条往本地栈写数据的实验**不会在测试里真跑**。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mintServiceJwt,
  parseArgs,
  runVariant,
} from "../../../scripts/lib/auth-deletion-equivalence-check.js";

type ParsedArgs = { error?: string; options?: Record<string, unknown> };
type FakeOptions = {
  tag?: string;
  after?: string;
  version?: string;
  adminDeleteStatus?: number;
  refreshStatus?: number;
  accessStatus?: number;
};
/** runVariant 住在无标注的 .js 里，返回值形状在这里显式收口，避免断言读成 {}。 */
type VariantResult = {
  residue: Record<string, string>;
  refreshStatus: number;
  accessStatus: number;
  gotrueVersion: string;
} | null;

type Deps = {
  psql: ReturnType<typeof vi.fn>;
  printenv: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
};

function optionsOf(parsed: ParsedArgs): Record<string, unknown> {
  expect(parsed.error).toBeUndefined();
  return parsed.options as Record<string, unknown>;
}

/** 假 GoTrue 的路由表：与 `cloud-sql-probe-io.test.ts` 同型，分支不写在 fetch 里。 */
function routes(options: FakeOptions) {
  return [
    { method: "GET", match: "/health", body: { version: options.version ?? "v2.195.0" }, status: 200 },
    { method: "POST", match: "/admin/users", body: { id: `u-${options.tag ?? "x"}` }, status: 201 },
    { method: "DELETE", match: "/admin/users", body: {}, status: options.adminDeleteStatus ?? 200 },
    { method: "POST", match: "grant_type=password", body: { access_token: "acc", refresh_token: "ref" }, status: 200 },
    { method: "POST", match: "grant_type=refresh_token", body: { code: 400 }, status: options.refreshStatus ?? 400 },
    { method: "GET", match: "/user", body: {}, status: options.accessStatus ?? 403 },
  ];
}

/** 造一套假栈：按 user_id 记「删前 1 / 删后 0」，并响应 GoTrue 的形状。 */
function fakeDeps(options: FakeOptions = {}) {
  const state = { deletedDirect: false };
  const deps: Deps = {
    psql: vi.fn((query: string) => {
      if (query.startsWith("delete from auth.users")) {
        state.deletedDirect = true;
        return "DELETE 1";
      }
      const match = /from auth\.(\w+) where user_id = '([^']+)'/.exec(query);
      if (!match) return "1";
      return options.after === "gone" ? "0" : "1";
    }),
    printenv: vi.fn(() => "local-secret"),
    fetch: vi.fn(async (url: unknown, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      const route = routes(options).find((entry) => entry.method === method && String(url).includes(entry.match));
      if (!route) throw new Error(`未登记的请求 ${method} ${String(url)}`);
      return new Response(JSON.stringify(route.body), { status: route.status });
    }),
  };
  return { deps, state };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseArgs", () => {
  it("--prod-url / --anon-key 覆盖默认", () => {
    const options = optionsOf(parseArgs(["--prod-url", "https://x.supabase.co", "--anon-key", "k"]) as ParsedArgs);
    expect(options.prodUrl).toBe("https://x.supabase.co");
    expect(options.anonKey).toBe("k");
  });

  it("未知 flag 报错", () => {
    expect((parseArgs(["--write-prod"]) as ParsedArgs).error).toContain("未知参数");
  });
});

describe("mintServiceJwt", () => {
  it("产出三段式 HS256 JWT，payload 带 service_role", () => {
    const jwt = mintServiceJwt("secret", 1_700_000_000);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
    expect(payload.role).toBe("service_role");
    expect(payload.exp).toBe(1_700_000_000 + 3600);
  });
});

describe("runVariant", () => {
  it("direct：走 SQL 删除并回传残留 + 旧凭据状态", async () => {
    const { deps, state } = fakeDeps({ tag: "direct", after: "gone" });
    const result = (await runVariant(deps, "http://localhost/auth/v1", "jwt", "direct")) as VariantResult;
    expect(result?.residue.sessions).toBe("0");
    expect(result?.refreshStatus).toBe(400);
    expect(result?.accessStatus).toBe(403);
    expect(result?.gotrueVersion).toBe("v2.195.0");
    expect(state.deletedDirect).toBe(true);
  });

  it("admin：走 DELETE /admin/users，不发 SQL 删除", async () => {
    const { deps, state } = fakeDeps({ tag: "admin", after: "gone" });
    const result = (await runVariant(deps, "http://localhost/auth/v1", "jwt", "admin")) as VariantResult;
    expect(result?.residue.identities).toBe("0");
    expect(state.deletedDirect).toBe(false);
  });

  it("建号失败 ⇒ null（调用方据此给 UNVERIFIABLE，不冒充结论）", async () => {
    const { deps } = fakeDeps();
    deps.fetch = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(((await runVariant(deps, "http://x/auth/v1", "jwt", "admin")) as VariantResult)).toBeNull();
  });

  it("admin 删号非 200 ⇒ null", async () => {
    const { deps } = fakeDeps({ tag: "admin", after: "gone", adminDeleteStatus: 500 });
    expect(((await runVariant(deps, "http://x/auth/v1", "jwt", "admin")) as VariantResult)).toBeNull();
  });

  it("残留读不出（psql 报错）⇒ 标成 unreadable，而不是静默当 0", async () => {
    const { deps } = fakeDeps({ tag: "x" });
    deps.psql = vi.fn(() => "ERR:permission denied");
    const result = (await runVariant(deps, "http://x/auth/v1", "jwt", "direct")) as VariantResult;
    expect(result?.residue.sessions).toBe("unreadable");
  });
});
