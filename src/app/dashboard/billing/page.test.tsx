/**
 * 账单页的读取失败契约（C08-b）
 *
 * 这一页最坏的地方不是「看不见套餐」，而是**看得见的套餐是假的**：
 * `currentPlan = teamInfo?.plan ?? "free"` 让一次读失败长成一个免费账户。
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

import BillingPage from "./page";

function fakeClient(read: { data?: unknown; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  const step = vi.fn(async () => ({ data: null, error: null, ...read }));
  builder.maybeSingle = step;
  builder.single = step;
  builder.then = step;
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: vi.fn(() => builder),
  });
  return step;
}

beforeEach(() => vi.clearAllMocks());

describe("BillingPage 的套餐读取", () => {
  it("读失败时抛出，而不是把付费账户显示成 free", async () => {
    fakeClient({ data: null, error: { message: "connection reset by peer" } });
    await expect(BillingPage()).rejects.toThrow("connection reset by peer");
  });

  it("确实还没有团队时正常渲染（那是合法状态，不是故障）", async () => {
    const step = fakeClient({ data: null });
    await expect(BillingPage()).resolves.toBeTruthy();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("读到 teams 数组形态时正常渲染（内嵌资源可能给数组也可能给对象）", async () => {
    fakeClient({ data: { team_id: "t1", teams: [{ plan: "pro", member_count: 2 }] } });
    await expect(BillingPage()).resolves.toBeTruthy();
  });
});
