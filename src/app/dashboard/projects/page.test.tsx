/**
 * 项目列表页的读取失败契约（C08-c）
 *
 * 两处读取的失败方向都是「你还没有项目」：归属读不到时三元表达式干脆跳过查询，
 * 项目行读不到时 `data` 为 null 又被 `?? []` 兜成空数组——两种都把故障说成了终态。
 * 所以每处故障都配一条合法状态当反向证据，否则「一律抛错」也能骗过这套测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import ProjectsPage from "./page";

type Read = { data?: unknown; error?: { message: string } | null };

/**
 * 假客户端：按「表名 + 该表第几次读取」返回预置结果。
 * 真客户端的查询链本身是 thenable，所以 `builder.then` 必须有——
 * 少了它，`await supabase.from(...).select(...)` 会 await 到一个普通对象，
 * `data` 与 `error` 双双 undefined，故障用例于是「什么都没读到」而不是「读到错误」。
 */
function fakeClient(reads: Record<string, Read[]>) {
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
    builder.maybeSingle = vi.fn(step);
    builder.then = (onFulfilled: (value: Read) => unknown) => step().then(onFulfilled);
    return builder;
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: vi.fn(forTable),
  };
  createClientMock.mockResolvedValue(client);
  return client;
}

const PROJECT = {
  id: "p1",
  name: "Demo",
  description: null,
  status: "active",
  visibility: "private",
  slug: "demo",
  config: null,
  created_by: "u1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const HAPPY: Record<string, Read[]> = {
  team_members: [{ data: { team_id: "t1" } }],
  projects: [{ data: [PROJECT] }],
};

const page = () => ProjectsPage({ searchParams: Promise.resolve({}) });

beforeEach(() => vi.clearAllMocks());

describe("ProjectsPage 的两处读取", () => {
  it("团队归属读失败时抛出，而不是跳过查询给出空列表", async () => {
    const client = fakeClient({
      team_members: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(page()).rejects.toThrow("connection terminated");
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("确实没有归属时空列表是合法答案，并且不再往下读", async () => {
    const client = fakeClient({ team_members: [{ data: null }] });
    await expect(page()).resolves.toBeTruthy();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("项目行读失败时抛出，而不是把故障显示成「你还没有项目」", async () => {
    fakeClient({
      team_members: [{ data: { team_id: "t1" } }],
      projects: [{ data: null, error: { message: "could not parse response" } }],
    });
    await expect(page()).rejects.toThrow("could not parse response");
  });

  it("项目行确实为空时照常渲染空态（那是合法状态，不是故障）", async () => {
    fakeClient({ ...HAPPY, projects: [{ data: [] }] });
    await expect(page()).resolves.toBeTruthy();
  });

  it("两处都读到时正常渲染", async () => {
    fakeClient(HAPPY);
    await expect(page()).resolves.toBeTruthy();
  });
});
