/**
 * /api/e2e/push-queue 的读取失败契约（C08-c）
 *
 * 这个端点是 E2E 的眼睛：它读错一次，spec 就拿着一份假的观察去断言真实行为。
 * 两处读取原先都不绑 `error`——`setPushPreference` 更严重：它读的是要被自己覆盖的那一列。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/mock", () => ({ isMockEnabled: true }));

import { GET, POST } from "./route";

type Read = { data?: unknown; error?: { message: string } | null };

/**
 * 假的管理端客户端：按「表名 + 该表第几次读取」预置结果，并记下哪些表被 `update` 过——
 * 「读失败时不许覆盖」这条结论只能靠**没有发出 update** 来证明，状态码证明不了。
 */
function fakeAdmin(steps: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const updated: string[] = [];
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(steps[table]?.[index] ?? { data: null, error: null });
    };
    for (const method of ["select", "eq", "order", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(step);
    builder.insert = vi.fn(() => builder);
    builder.delete = vi.fn(() => builder);
    builder.update = vi.fn(() => {
      updated.push(table);
      return builder;
    });
    builder.then = (onFulfilled: (value: Read) => unknown) => step().then(onFulfilled);
    return builder;
  };
  const client = { from: vi.fn((table: string) => forTable(table)) };
  createAdminClientMock.mockReturnValue(client);
  return { client, updated };
}

function request(method: "GET" | "POST", body?: Record<string, unknown>, query = "") {
  return new NextRequest(`http://localhost/api/e2e/push-queue${query}`, {
    method,
    headers: { authorization: "Bearer e2e-token" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.E2E_BEARER_TOKEN = "e2e-token";
});

describe("POST：种子写入前的偏好读取", () => {
  it("读不到 notification_settings 时停下来，且不覆盖那一列", async () => {
    const { updated } = fakeAdmin({
      profiles: [{ data: null, error: { message: "connection terminated" } }],
    });
    await expect(POST(request("POST", { pushDisabled: true }))).rejects.toThrow(
      "connection terminated",
    );
    expect(updated).not.toContain("profiles");
  });

  it("偏好行确实不存在时照常写入（那是一份干净的空偏好，不是故障）", async () => {
    const { updated } = fakeAdmin({ profiles: [{ data: null, error: null }] });
    const response = await POST(request("POST", { pushDisabled: true }));
    expect(response.status).toBe(200);
    expect(updated).toContain("profiles");
  });

  it("读到的偏好会原样保留，只改 push 那一项", async () => {
    const steps: Record<string, Read[]> = {
      profiles: [{ data: { notification_settings: { digest: true, weekly: false } } }],
    };
    fakeAdmin(steps);
    const response = await POST(request("POST", { pushDisabled: true }));
    expect(response.status).toBe(200);
    expect((await response.json()).notificationId).toBeTruthy();
  });
});

describe("GET：队列观察", () => {
  it("投递记录读失败回 500，而不是报「队列为空」", async () => {
    fakeAdmin({
      push_delivery_attempts: [{ data: null, error: { message: "could not parse response" } }],
    });
    const response = await GET(request("GET"));
    expect(response.status).toBe(500);
  });

  it("订阅读失败同样回 500，而不是把「没读到」当成「没有订阅」", async () => {
    fakeAdmin({
      push_delivery_attempts: [{ data: [{ id: "a1", endpoint: "https://push-e2e.test/ok" }] }],
      push_subscriptions: [{ data: null, error: { message: "subscriptions unreadable" } }],
    });
    const response = await GET(request("GET"));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("subscriptions unreadable");
  });

  it("订阅确实为空时照常返回空列表（那是合法状态）", async () => {
    fakeAdmin({
      push_delivery_attempts: [{ data: [{ id: "a1", endpoint: "https://push-e2e.test/ok" }] }],
      push_subscriptions: [{ data: [] }],
    });
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subscriptions).toEqual([]);
    expect(body.total).toBe(1);
  });
});
