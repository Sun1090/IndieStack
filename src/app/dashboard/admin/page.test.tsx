/**
 * 管理概览页的读取失败契约（C08-c）
 *
 * 这一页读的是**面板上唯一的数字**，三处读取原先都不绑 `error`：一次故障会渲染成
 * 「0 个用户 / 0 个团队 / 0 个管理员」——那看起来像一个刚初始化的空实例，而不是坏了。
 * 每条故障都配一条合法状态当反向证据，否则「一律抛错」也能骗过这套测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, redirectMock, guardMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  redirectMock: vi.fn(),
  guardMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ safelyRequireRole: guardMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/mock", () => ({
  shouldUseMock: () => false,
  generateMockAdminStats: () => ({}),
}));
vi.mock("@/lib/repositories/contact-messages", () => ({ countContactMessages: async () => 0 }));
vi.mock("@/lib/repositories/webhook-events", () => ({ countWebhookEvents: async () => 0 }));
const queueState = {
  current: {
    pending: 0,
    oldestAgeMs: null as string | null,
    emptySendRounds: 0,
    stale: false,
    skippedByReason: { no_email: 0, preferences_off: 0 },
    readBeforeSend: 0,
    trend: {
      code: "INSUFFICIENT_DATA" as string,
      attention: true,
      reason: "一条读数都没有。",
    },
    trendRounds: 0,
  },
};

vi.mock("@/lib/notifications/queue-observability", () => ({
  // 形状必须跟 QueueDiagnostics 对齐：#152 之后多了 skippedByReason 与 readBeforeSend，
  // 少写字段不会编译报错，只会在页面上读 undefined 时炸——所以这里逐字段给全。
  // 读 `queueState.current` 而不是内联一份：否则想测「趋势变好之后面板怎么显示」
  // 就得复制整个 mock——而复制出来的 mock 往往漏字段，漏了也不报错。
  readEmailQueueDiagnostics: async () => queueState.current,
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    redirectMock();
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import AdminPage from "./page";

type Read = { data?: unknown; count?: number | null; error?: { message: string } | null };

/**
 * 假的管理端客户端：按「表名 + 该表第几次读取」返回预置结果。
 * `profiles` 被读两次（总数计数、角色分布），所以必须能指名让其中一次失败。
 * 链本身要能 `await`（页面直接 await `.select(...)` 的结果），少了 `then` 就等于什么都没读到。
 */
function fakeAdmin(reads: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(reads[table]?.[index] ?? { data: null, count: null, error: null });
    };
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (onFulfilled: (value: Read) => unknown) => step().then(onFulfilled);
    return builder;
  };
  const client = { from: vi.fn(forTable) };
  createAdminClientMock.mockReturnValue(client);
  return client;
}

/**
 * 把返回的元素树摊平成字符串。
 * 只断言 `resolves.toBeTruthy()` 的话，「数字其实来自那次读取」这件事是没证据的——
 * 把 `totalUsers` 写死成 0、或者让角色分布永远不计数，测试照样全绿。
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
  const element = node as { props?: { children?: unknown } };
  if (element.props?.children !== undefined) textsOf(element.props.children, acc);
  return acc;
}

const HAPPY: Record<string, Read[]> = {
  profiles: [
    { count: 7, error: null },
    { data: [{ role: "admin" }, { role: "member" }], error: null },
  ],
  teams: [{ count: 2, error: null }],
};

beforeEach(() => {
  vi.clearAllMocks();
  guardMock.mockResolvedValue({ success: true, data: { id: "u1" } });
  // 每条用例都从同一份默认读数起步：**用例之间不留状态**——
  // 否则「把趋势改成另一种」的那条会污染后面的，而症状是「单跑绿、全跑红」。
  queueState.current = {
    pending: 0,
    oldestAgeMs: null,
    emptySendRounds: 0,
    stale: false,
    skippedByReason: { no_email: 0, preferences_off: 0 },
    readBeforeSend: 0,
    trend: { code: "INSUFFICIENT_DATA", attention: true, reason: "一条读数都没有。" },
    trendRounds: 0,
  };
});

describe("AdminPage 的三处统计读取", () => {
  it("用户总数读失败时抛出，而不是显示「0 个用户」", async () => {
    fakeAdmin({
      profiles: [{ count: null, error: { message: "connection terminated" } }],
    });
    await expect(AdminPage()).rejects.toThrow("connection terminated");
  });

  it("确实没有用户（计数为 0、无错误）时照常渲染，那是合法的空实例", async () => {
    fakeAdmin({ profiles: [{ count: 0, error: null }, { data: [], error: null }], teams: [{ count: 0, error: null }] });
    await expect(AdminPage()).resolves.toBeTruthy();
  });

  it("团队总数读失败时抛出，而不是把整棵树抹成 0", async () => {
    fakeAdmin({
      ...HAPPY,
      teams: [{ count: null, error: { message: "could not parse response" } }],
    });
    await expect(AdminPage()).rejects.toThrow("could not parse response");
  });

  it("角色分布读失败时抛出，而不是显示「0 个管理员」", async () => {
    fakeAdmin({
      profiles: [
        { count: 7, error: null },
        { data: null, error: { message: "too-many-requests" } },
      ],
      teams: [{ count: 2, error: null }],
    });
    await expect(AdminPage()).rejects.toThrow("too-many-requests");
  });

  it("三处都读到时正常渲染，且面板上的数字就是读到的那些", async () => {
    fakeAdmin(HAPPY);
    const page = await AdminPage();
    const shown = textsOf(page);
    expect(shown).toContain("7"); // totalUsers
    expect(shown).toContain("2"); // totalTeams
    expect(shown).toContain("super_admin 0 / admin 1"); // 角色分布来自 profiles.role 那一次读取
  });

  it("趋势结论真的上了面板（否则「数据通了但没人看」又发生了）", async () => {
    queueState.current = {
      ...queueState.current,
      trend: {
        code: "BACKLOG_NOT_DRAINING",
        attention: true,
        reason: "跳过在涨但积压没降。",
      },
      trendRounds: 4,
    };
    fakeAdmin(HAPPY);
    const shown = textsOf(await AdminPage());
        // 假翻译直接回显键，所以「这个键出现在面板上」就等于「这条卡片真的渲染了」
    expect(shown).toContain("overview.stats.trend");
    expect(shown.some((x) => x.includes("overview.stats.trendNotDraining"))).toBe(true);
    expect(shown.some((x) => x.includes('overview.stats.trendDays'))).toBe(true);
    // 需要人看一眼时：marker 必须是 `!`（而不是 `OK`）
    expect(shown).toContain("!");
  });

  it("**数据不足时面板说「读数不足」，而不是给一个像结论的标签**", async () => {
    queueState.current = {
      ...queueState.current,
      trend: { code: "INSUFFICIENT_DATA", attention: true, reason: "读数不足。" },
      trendRounds: 0,
    };
    fakeAdmin(HAPPY);
    const shown = textsOf(await AdminPage());
    expect(shown).toContain("overview.stats.trendInsufficient");
    expect(shown).not.toContain("overview.stats.trendHealthy");
    expect(shown).not.toContain("overview.stats.trendDraining");
  });

  it("守卫说没权限时走 redirect，一次库都不读", async () => {
    guardMock.mockResolvedValue({ success: false, error: { message: "forbidden" } });
    const client = fakeAdmin(HAPPY);
    await expect(AdminPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });
});
