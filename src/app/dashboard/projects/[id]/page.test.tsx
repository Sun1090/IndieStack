/**
 * 项目详情页的读取失败契约（C08-c）
 *
 * 这一页原先把 `error: null` 写进断言——那不是「保留错误通道」，是断言「不可能有 error」。
 * 于是两次抖动都会被下面的 `notFound()` 渲染成 404「这个项目不存在」：用户以为项目没了，
 * 而 404 是终态、重试不会变，真正该做的只是刷新。现在故障在渲染之前抛出，404 只留给真缺行。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, notFoundMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  notFoundMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    notFoundMock();
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const t = (key: string) => key;
    t.has = () => false;
    return t;
  },
  getLocale: async () => "zh-CN",
}));

import ProjectDetailPage from "./page";

type Read = { data?: unknown; error?: { message: string } | null };

/** 按「表名 + 该表第几次读取」返回预置结果；见 team/page.test.tsx 里对 `then` 的说明。 */
function fakeClient(reads: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(reads[table]?.[index] ?? { data: null, error: null });
    };
    for (const method of ["select", "eq", "limit"]) {
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
  config: { branch: "main" },
  created_by: "u1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

const HAPPY: Record<string, Read[]> = {
  team_members: [{ data: { team_id: "t1" } }],
  projects: [{ data: PROJECT }],
};

const page = () => ProjectDetailPage({ params: Promise.resolve({ id: "p1" }) });

beforeEach(() => vi.clearAllMocks());

describe("ProjectDetailPage 的两处读取", () => {
  it("团队归属读失败时抛出真因，而不是渲染 404", async () => {
    const client = fakeClient({
      team_members: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(page()).rejects.toThrow("connection terminated");
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("确实没有归属时才是 404，并且不再往下读", async () => {
    const client = fakeClient({ team_members: [{ data: null }] });
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("项目行读失败时抛出真因，而不是把抖动说成「项目不存在」", async () => {
    fakeClient({
      ...HAPPY,
      projects: [{ data: null, error: { message: "could not parse response" } }],
    });
    await expect(page()).rejects.toThrow("could not parse response");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("项目行确实缺失时仍是 404（那是合法终态，不是故障）", async () => {
    fakeClient({ ...HAPPY, projects: [{ data: null }] });
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("两处都读到时正常渲染", async () => {
    fakeClient(HAPPY);
    await expect(page()).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
