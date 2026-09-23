/**
 * 仪表盘总览的读取失败契约（C08-c）
 *
 * 这是多数用户进来看到的第一屏。四个统计数与套餐徽章原先都不看 `error`，
 * 一次故障会渲染成一整屏**合法的终态**：0 个项目、0 次调用、0 个会话、没有通知、套餐 free。
 * 所以每条故障都配一条合法状态当反向证据——否则「一律抛错」也能骗过这套测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import DashboardOverview from "./page";

type Read = { data?: unknown; count?: number | null; error?: { message: string } | null };

/** 按「表名 + 该表第几次读取」预置结果；链必须可 `await`（`Promise.all` 里就是直接 await 它）。 */
function fakeClient(reads: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(reads[table]?.[index] ?? { data: null, count: null, error: null });
    };
    for (const method of ["select", "eq", "gte", "in", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    /**
     * `.single()` 在「没有这一行」时给的是真错误，`.maybeSingle()` 给的是 `data: null`。
     * 两个终局共用同一份预置数据、按**被调用的那个**加工——否则代码在两者之间来回改，
     * 在桩里长得一模一样，测试永远看不见（这条在 `actions/team.test.ts` 里已经栽过一次）。
     */
    const terminal = (kind: "single" | "maybeSingle") => {
      const result = step();
      if (kind !== "single") return result;
      return result.then((value) =>
        !value.error && (value.data === null || value.data === undefined)
          ? { ...value, error: { message: "no rows returned" } }
          : value,
      );
    };
    builder.single = vi.fn(() => terminal("single"));
    builder.maybeSingle = vi.fn(() => terminal("maybeSingle"));
    builder.then = (onFulfilled: (value: Read) => unknown) => step().then(onFulfilled);
    return builder;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@b.c" } } }) },
    from: vi.fn(forTable),
  };
  createClientMock.mockResolvedValue(client);
  return client;
}

/**
 * 把返回的要素树摊平成字符串（既收 `children`，也收 `value` 这类**直接当 prop 传的**数字/文本）。
 * 目的只有一个：证明第一屏上的数字来自那次读取，而不是写死的 0。
 */
function textsOf(node: unknown, acc: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return acc;
  if (Array.isArray(node)) {
    node.forEach((child) => textsOf(child, acc));
    return acc;
  }
  if (typeof node === "string" || typeof node === "number") {
    acc.push(String(node));
    return acc;
  }
  const element = node as { props?: Record<string, unknown> };
  if (!element.props) return acc;
  for (const [key, value] of Object.entries(element.props)) {
    if (key === "children") textsOf(value, acc);
    else if (typeof value === "string" || typeof value === "number") acc.push(String(value));
    else if (Array.isArray(value)) textsOf(value, acc);
  }
  return acc;
}

const OWN_TEAM: Read[] = [{ data: { team_id: "t1", teams: { name: "Acme", plan: "pro", member_count: 2 } } }];

const HAPPY: Record<string, Read[]> = {
  profiles: [{ data: { id: "u1", full_name: "Ada" } }],
  team_members: OWN_TEAM,
  projects: [{ count: 3 }],
  api_usage: [{ count: 120 }],
  user_sessions: [{ count: 7 }],
  notifications: [{ data: [{ id: "n1", title: "部署完成", body: "", type: "info", created_at: "2026-09-01T00:00:00Z" }] }],
};

beforeEach(() => vi.clearAllMocks());

describe("DashboardOverview 的六处读取", () => {
  it("资料读失败时抛出，而不是把问候语降级成「欢迎回来」", async () => {
    fakeClient({
      ...HAPPY,
      profiles: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(DashboardOverview()).rejects.toThrow("connection terminated");
  });

  it("团队归属读失败时抛出，而不是把套餐显示成 free", async () => {
    const client = fakeClient({
      ...HAPPY,
      team_members: [{ data: null, error: { message: "could not parse response" } }],
    });
    await expect(DashboardOverview()).rejects.toThrow("could not parse response");
    // 归属没读到就不该继续往下问四个数
    expect(client.from.mock.calls.filter((c: string[]) => c[0] === "api_usage")).toHaveLength(0);
  });

  it("确实没有归属时照常渲染，并且根本不查 projects（那是合法的个人用户）", async () => {
    const client = fakeClient({
      ...HAPPY,
      team_members: [{ data: null }],
      projects: [],
    });
    await expect(DashboardOverview()).resolves.toBeTruthy();
    expect(client.from.mock.calls.filter((c: string[]) => c[0] === "projects")).toHaveLength(0);
  });

  it("API 调用数读失败时抛出，而不是说「你的密钥没人用」", async () => {
    fakeClient({ ...HAPPY, api_usage: [{ count: null, error: { message: "too-many-requests" } }] });
    await expect(DashboardOverview()).rejects.toThrow("too-many-requests");
  });

  it("会话数读失败时抛出，而不是显示 0 个会话", async () => {
    fakeClient({
      ...HAPPY,
      user_sessions: [{ count: null, error: { message: "session read failed" } }],
    });
    await expect(DashboardOverview()).rejects.toThrow("session read failed");
  });

  it("最近通知读失败时抛出，而不是渲染成「还没有活动」", async () => {
    fakeClient({
      ...HAPPY,
      notifications: [{ data: null, error: { message: "notifications unreadable" } }],
    });
    await expect(DashboardOverview()).rejects.toThrow("notifications unreadable");
  });

  it("六处都读到时照常渲染，且第一屏上的数字就是读到的那些", async () => {
    fakeClient(HAPPY);
    const shown = textsOf(await DashboardOverview());
    expect(shown).toContain("3"); // 项目数
    expect(shown).toContain("120"); // API 调用数
    expect(shown).toContain("7"); // 会话数
    expect(shown).toContain("部署完成"); // 最近活动
    // 问候语是 `, ${full_name}` 拼出来的，所以只能按子串找；数字保持精确匹配，
    // 否则 `text-3xl` 这类类名会把「找到了 3」变成假证据。
    expect(shown.join(" ")).toContain("Ada");
  });

  it("资料行确实缺失时照常渲染（那是合法的不完整资料，不该进错误页）", async () => {
    fakeClient({ ...HAPPY, profiles: [{ data: null, error: null }] });
    await expect(DashboardOverview()).resolves.toBeTruthy();
  });

  it("资料行确实缺失时照常渲染（那是数据不一致，不是读失败，问候语不该变成错误页）", async () => {
    fakeClient({ ...HAPPY, profiles: [{ data: null }] });
    await expect(DashboardOverview()).resolves.toBeTruthy();
  });

  it("计数为 0 且没有错误时照常渲染（那是合法的空数据，不是故障）", async () => {
    fakeClient({
      ...HAPPY,
      projects: [{ count: 0 }],
      api_usage: [{ count: 0 }],
      user_sessions: [{ count: 0 }],
      notifications: [{ data: [] }],
    });
    await expect(DashboardOverview()).resolves.toBeTruthy();
  });
});
