/**
 * 团队页的读取失败契约（C08-b）
 *
 * 三处读取各有自己的失败方向，所以各自一条用例；每处故障都配一条合法状态当反向证据，
 * 否则「一律抛错」也能骗过这套测试。
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import TeamPage from "./page";

type Read = { data?: unknown; error?: { message: string } | null };

/**
 * 假客户端：按「表名 + 该表第几次读取」返回预置结果。
 * `team_members` 在这一页被读两次（我的成员身份、成员列表），必须能指名让其中一次失败。
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
    for (const method of ["select", "eq", "limit", "order"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(step);
    builder.single = vi.fn(step);
    // 真客户端的查询链本身是 thenable（`const { data, error } = await supabase.from(...).eq(...)`
    // 就是直接 await 它）。少了这一行，列表那一路会 await 到一个普通对象，
    // `data` 与 `error` 双双 undefined —— 故障用例于是「什么都没读到」而不是「读到错误」，测试照绿。
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

const HAPPY: Record<string, Read[]> = {
  team_members: [
    { data: { team_id: "t1", role: "owner" } },
    {
      data: [
        {
          id: "m1",
          role: "owner",
          created_at: "2026-01-01T00:00:00Z",
          user_id: "u1",
          profiles: { id: "u1", email: "a@b.c", full_name: "Owner", avatar_url: null },
        },
      ],
    },
  ],
  teams: [{ data: { id: "t1", plan: "pro", member_count: 1 } }],
};

beforeEach(() => vi.clearAllMocks());

describe("TeamPage 的三处读取", () => {
  it("成员身份读失败时抛出，而不是渲染「你还没有团队」", async () => {
    fakeClient({
      team_members: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(TeamPage()).rejects.toThrow("connection terminated");
  });

  it("确实没有团队时才渲染空态，并且不再往下读", async () => {
    const client = fakeClient({ team_members: [{ data: null }] });
    await expect(TeamPage()).resolves.toBeTruthy();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("团队行读失败时抛出，而不是把套餐显示成 free", async () => {
    fakeClient({
      ...HAPPY,
      teams: [{ data: null, error: { message: "could not parse response" } }],
    });
    await expect(TeamPage()).rejects.toThrow("could not parse response");
  });

  it("团队行确实缺失时仍照常渲染（那是合法状态，不是故障）", async () => {
    fakeClient({ ...HAPPY, teams: [{ data: null }] });
    await expect(TeamPage()).resolves.toBeTruthy();
  });

  it("成员列表读失败时抛出，而不是把满员的团队显示成 0 人", async () => {
    fakeClient({
      team_members: [
        { data: { team_id: "t1", role: "owner" } },
        { data: null, error: { message: "too-many-requests" } },
      ],
      teams: [{ data: { id: "t1", plan: "pro", member_count: 1 } }],
    });
    await expect(TeamPage()).rejects.toThrow("too-many-requests");
  });

  it("三处都读到时正常渲染", async () => {
    fakeClient(HAPPY);
    await expect(TeamPage()).resolves.toBeTruthy();
  });
});
