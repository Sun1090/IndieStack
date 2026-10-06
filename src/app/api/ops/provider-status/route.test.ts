/**
 * /api/ops/provider-status 路由测试
 *
 * 覆盖三件真正要紧的事：
 * 1. **匿名不可读**——匿名调用者能据此枚举出本项目用到哪些第三方服务与变量名；
 * 2. **只回键名、不回值**——这是这个端点唯一的安全边界；
 * 3. **可选依赖缺失不算故障**——生产没配 Stripe 是正常发布形态，
 *    若因此返回非 2xx，运维脚本会天天误报。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const SECRET = "cron-secret";

/** 这是一个**真的**长得像凭据的哨兵值：任何把它回显出来的实现都该红。 */
const CANARY_KEY = "resend";
const CANARY_VALUE = "re_canary_do_not_echo_me_0123456789";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/ops/provider-status", { headers });
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${SECRET}` };
}

let savedEnv: Record<string, string | undefined>;

/** 只动列出的键，避免测试之间互相污染。 */
const TOUCHED = [
  "CRON_SECRET",
  "RESEND_API_KEY",
  "STRIPE_FROM",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
  "NEXT_PUBLIC_MOCK_ENABLED",
];

beforeEach(() => {
  savedEnv = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const key of TOUCHED) delete process.env[key];
  process.env.CRON_SECRET = SECRET;
  // **关键**：测试环境默认没有 NEXT_PUBLIC_SUPABASE_URL，于是 `evaluateMockMode`
  // 判定 mock 模式为 true —— 而 mock 模式下**每个 provider 的 `missing` 都是空数组**。
  // 第一版的哨兵测试就栽在这里：它断言的其实是一个空数组，**怎么改实现都不会红**。
  // 显式给出 URL 关掉 mock，才能真正测到「键名出现、值不出现」。
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key-for-test";
  process.env.NEXT_PUBLIC_MOCK_ENABLED = "false";
});

afterEach(() => {
  for (const key of TOUCHED) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("GET /api/ops/provider-status", () => {
  it("匿名请求被拒（401）", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.ok).toBe(false);
    // 拒绝时**不能**顺带把 provider 清单吐出来——那等于「拒绝但仍然泄露」
    expect(body.providers).toBeUndefined();
  });

  it("错误密钥同样被拒（共享密钥不是摆设）", async () => {
    const response = await GET(request({ authorization: "Bearer wrong-secret" }));
    expect(response.status).toBe(401);
  });

  it("带密钥可读，且报告结构与 diagnoseProviders 同构", async () => {
    const response = await GET(request(authHeaders()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers.length).toBeGreaterThan(0);
    for (const provider of body.providers) {
      expect(provider).toHaveProperty("id");
      expect(provider).toHaveProperty("status");
      expect(provider).toHaveProperty("configured");
      expect(provider).toHaveProperty("required");
      // 键名数组，不是值
      expect(Array.isArray(provider.missing)).toBe(true);
    }
    expect(typeof body.checkedAt).toBe("string");
  });

  it("**响应里绝不出现凭据的值**——已配置的依赖也一样", async () => {
    // 刻意把邮件依赖**配齐**（RESEND_API_KEY 是其键之一），让 canary 落在
    // 一个 `configured=true` 的 provider 上。这才是真正可达的泄露路径：
    // 诊断报告里 `missing` 按定义只装键名，缺失的键本来就没有值，
    // 所以「值从 missing 漏出去」在结构上不可能发生——第一版的变异就是这样白测通过的。
    // 真正要防的是**实现顺手把已配置项的值也带进响应**（比如为了「方便排查」）。
    process.env.RESEND_API_KEY = CANARY_VALUE;
    process.env.RESEND_FROM = "ops@example.com";
    const response = await GET(request(authHeaders()));
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw.includes(CANARY_VALUE)).toBe(false);
    // 连截断/前缀出现也不行
    expect(raw).not.toContain(CANARY_VALUE.slice(0, 20));
    // 结构上逐项核对：每个 provider 的每个字符串字段都不等于哨兵
    const body = JSON.parse(raw) as {
      providers: { id: string; label: string; notes: string[]; missing: string[] }[];
    };
    for (const provider of body.providers) {
      for (const note of provider.notes) expect(note).not.toContain(CANARY_VALUE);
      for (const name of provider.missing) expect(name).not.toContain(CANARY_VALUE);
      expect(provider.label).not.toContain(CANARY_VALUE);
    }
    // 且缺失的键名仍然照常出现——端点没有因为脱敏而失去用处
    expect(raw).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("可选依赖缺失时仍是 200 —— 可选依赖没配是正常发布形态", async () => {
    // 全部依赖都不配（最坏情况）。端点必须**仍然 200**：
    // 若可选依赖缺失就让响应非 2xx，运维脚本会把它当故障——那是一个天天误报的信号位。
    for (const key of TOUCHED) if (key !== "CRON_SECRET") delete process.env[key];
    const response = await GET(request(authHeaders()));
    expect(response.status).toBe(200);
    const body = await response.json();
    // `ok` 只反映**必需**依赖；必需项缺失时它为 false，读数在 problems 里
    expect(typeof body.ok).toBe("boolean");
    // 无论 ok 是 true 还是 false，200 都不变——这是本条要钉的
    expect(Array.isArray(body.providers)).toBe(true);
    // 且**没有**任何可选依赖被报成 required：缺了就缺了，不是缺了就坏
    for (const provider of body.providers) {
      if (["email", "stripe", "sentry", "webpush", "appark", "storage"].includes(provider.id)) {
        expect(provider.required).toBe(false);
      }
    }
  });

  it("缓存不得被复用——实况每次读当下的环境", async () => {
    const response = await GET(request(authHeaders()));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});