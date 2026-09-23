/**
 * 设置页的设备列表与资料读取契约（C08-c）
 *
 * 这一屏给的是**可吊销的会话列表**：读失败时它落成「只有当前这台设备」，
 * 而认不出「哪台是当前」时，用户会把自已正用的那台当成别人的设备点下去。
 * 每条故障都配一条合法状态当反向证据。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, listMyCredentialsMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  listMyCredentialsMock: vi.fn(async () => []),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/repositories/webauthn", () => ({ listMyCredentials: listMyCredentialsMock }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import SettingsPage from "./page";

type Read = { data?: unknown; error?: { message: string } | null };

/** 按「表名 + 该表第几次读取」预置；链必须可 `await`（`Promise.all` 里就是直接 await 它）。 */
function fakeClient(reads: Record<string, Read[]>, session: Read = { data: { session: null } }) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(reads[table]?.[index] ?? { data: null, error: null });
    };
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    /** `.single()` 撞 null 行是真错误；两个终局按**被调用的那个**加工（见 #107 的同一规则）。 */
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
    auth: {
      getUser: async () => ({ data: { user: { id: "u1", email: "a@b.c" } } }),
      getSession: async () => session,
    },
    from: vi.fn(forTable),
  };
  createClientMock.mockResolvedValue(client);
  return client;
}

/** 摊平元素树（含 `value`/`sessionId` 这类 prop），用来证明列表来自那次读取。 */
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

/** 真的解出 `session_id` 的假 JWT（`sessionIdFromAccessToken` 读的是 payload）。 */
function tokenFor(sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
  return `header.${payload}.signature`;
}

const DEVICES = [
  {
    id: "sess-current",
    user_id: "u1",
    user_agent: "Chrome on macOS",
    ip_address: "203.0.113.7",
    last_seen_at: "2026-09-20T00:00:00Z",
    created_at: "2026-09-19T00:00:00Z",
  },
  {
    id: "sess-other",
    user_id: "u1",
    user_agent: "Edge on Windows",
    ip_address: "198.51.100.4",
    last_seen_at: "2026-09-18T00:00:00Z",
    created_at: "2026-09-17T00:00:00Z",
  },
];

const HAPPY: Record<string, Read[]> = {
  profiles: [{ data: { id: "u1", full_name: "Ada" } }],
  user_sessions: [{ data: DEVICES }],
};

beforeEach(() => vi.clearAllMocks());

describe("SettingsPage 的两处读取", () => {
  it("资料读失败时抛出，而不是把表单预填成空值", async () => {
    fakeClient({
      ...HAPPY,
      profiles: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(SettingsPage()).rejects.toThrow("connection terminated");
  });

  it("资料行确实缺失时照常渲染（那是不完整的资料，不是故障）", async () => {
    fakeClient({ ...HAPPY, profiles: [{ data: null }] });
    await expect(SettingsPage()).resolves.toBeTruthy();
  });

  it("设备读失败时抛出，而不是说「你只有当前这台设备」", async () => {
    fakeClient({
      ...HAPPY,
      user_sessions: [{ data: null, error: { message: "could not parse response" } }],
    });
    await expect(SettingsPage()).rejects.toThrow("could not parse response");
  });

  it("认不出当前会话时抛出：列表每台都可吊销，不该递出砍向自己的那把刀", async () => {
    fakeClient(HAPPY, { data: { session: null }, error: { message: "auth unavailable" } });
    await expect(SettingsPage()).rejects.toThrow("auth unavailable");
  });

  it("设备确实为空时照常渲染空列表（那是合法状态）", async () => {
    fakeClient({ ...HAPPY, user_sessions: [{ data: [] }] });
    await expect(SettingsPage()).resolves.toBeTruthy();
  });

  it("两处都读到时渲染：两台都在列表里，而当前那台不给吊销按钮", async () => {
    fakeClient(HAPPY, {
      data: { session: { access_token: tokenFor("sess-current") } },
    });
    const shown = textsOf(await SettingsPage());
    expect(shown).toContain("Chrome on macOS"); // 两行都来自那次读取
    expect(shown).toContain("Edge on Windows");
    // 当前那台不该带出吊销入口（`sessionId` prop），另一台正好相反：
    // 认错当前设备的代价是把自己踢下线，所以这一对方向必须钉住。
    expect(shown.filter((value) => value === "sess-other").length).toBe(1);
    expect(shown).not.toContain("sess-current");
  });
});
