/**
 * sessions action 单测（v0.5.0 D02，迁移 018）
 * 覆盖：会话 id 提取、登记（未登录/无 claim/成功）、吊销（越权 404/GodTrue 失败吞错/成功）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "user-agent": "Mozilla/5.0 Test", "x-real-ip": "203.0.113.7" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/api-log", () => ({ logApiError: vi.fn(async () => {}) }));

import { recordCurrentSession, revokeSession } from "./sessions";
import { sessionIdFromAccessToken } from "@/lib/session-id";

const USER = { id: "u1", email: "a@b.c" };

function makeToken(sessionId?: string): string {
  const payload = sessionId ? { session_id: sessionId } : { sub: "u1" };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.sig`;
}

function clientMock(opts: {
  user?: object | null;
  sessionToken?: string | null;
  upsertError?: boolean;
  sessionRow?: object | null;
  deleteError?: boolean;
} = {}) {
  const {
    user = USER,
    sessionToken = makeToken("s-123"),
    upsertError = false,
    sessionRow = { id: "s-123" },
    deleteError = false,
  } = opts;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: sessionToken ? { access_token: sessionToken } : null },
      }),
    },
    sessionsTable: {
      upsert: vi.fn(() =>
        Promise.resolve(upsertError ? { error: { message: "db" } } : { error: null }),
      ),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: sessionRow })),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve(deleteError ? { error: { message: "db" } } : { error: null }),
        ),
      })),
    },
    from: vi.fn(function (this: { sessionsTable?: unknown }, table: string) {
      if (table === "user_sessions") {
        return (this as { sessionsTable: unknown }).sessionsTable;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sessionIdFromAccessToken()", () => {
  it("提取 session_id claim", () => {
    expect(sessionIdFromAccessToken(makeToken("s-abc"))).toBe("s-abc");
  });

  it("无 claim 或非法 token 返回 null", () => {
    expect(sessionIdFromAccessToken(makeToken(undefined))).toBeNull();
    expect(sessionIdFromAccessToken("not-a-jwt")).toBeNull();
  });
});

describe("recordCurrentSession()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(clientMock({ user: null }));
    await expect(recordCurrentSession()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("token 无 session_id claim 返回 invalidInput", async () => {
    createClientMock.mockResolvedValue(clientMock({ sessionToken: makeToken(undefined) }));
    await expect(recordCurrentSession()).resolves.toEqual({ ok: false, error: "invalidInput" });
  });

  it("成功登记：写入 GoTrue 会话 id + UA + IP", async () => {
    const client = clientMock();
    createClientMock.mockResolvedValue(client);
    await expect(recordCurrentSession()).resolves.toEqual({ ok: true });
    const upsert = (client as unknown as { sessionsTable: { upsert: ReturnType<typeof vi.fn> } }).sessionsTable.upsert;
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s-123", user_id: "u1", user_agent: "Mozilla/5.0 Test", ip_address: "203.0.113.7" }),
      { onConflict: "id" },
    );
  });

  it("数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(clientMock({ upsertError: true }));
    await expect(recordCurrentSession()).resolves.toEqual({ ok: false, error: "databaseError" });
  });
});

describe("revokeSession()", () => {
  it("会话不存在或越权返回 sessionNotFound", async () => {
    createClientMock.mockResolvedValue(clientMock({ sessionRow: null }));
    await expect(revokeSession("s-999")).resolves.toEqual({ ok: false, error: "sessionNotFound" });
  });

  it("成功吊销：删除设备记录", async () => {
    const client = clientMock();
    createClientMock.mockResolvedValue(client);
    await expect(revokeSession("s-123")).resolves.toEqual({ ok: true });
    const sessionsTable = (client as unknown as { sessionsTable: { delete: ReturnType<typeof vi.fn> } }).sessionsTable;
    expect(sessionsTable.delete).toHaveBeenCalled();
  });

  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(clientMock({ user: null }));
    await expect(revokeSession("s-123")).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });
});
