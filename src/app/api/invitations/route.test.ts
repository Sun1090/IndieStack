/**
 * 团队邀请路由单测（C08-b 第三批）
 *
 * 只钉一件事：这个路由上的每一次读取都同时是**授权或幂等判定**的输入，
 * 所以「读失败」与「读到了但没有这一行」必须是两个不同的回答。
 * 每条故障用例都配一条合法状态用例当反向证据——否则「503」可以靠把所有读取都判成失败来骗过测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  clientMock,
  adminMock,
  logApiErrorMock,
  requirePermissionMock,
  notifyUserMock,
  syncCountMock,
} = vi.hoisted(() => ({
  clientMock: vi.fn(),
  adminMock: vi.fn(),
  logApiErrorMock: vi.fn(),
  requirePermissionMock: vi.fn(),
  notifyUserMock: vi.fn(),
  syncCountMock: vi.fn(),
}));

vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));
vi.mock("@/lib/auth/guards", () => ({
  safelyRequirePermission: requirePermissionMock,
  guardHttpStatus: (e: { code: string }) => (e.code === "UNAUTHORIZED" ? 401 : 403),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: { check: async () => ({ allowed: true, resetIn: 1 }) },
}));
vi.mock("@/lib/email-notify", () => ({ notifyUser: notifyUserMock }));
vi.mock("@/lib/repositories/teams", () => ({ syncTeamMemberCount: syncCountMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: clientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));

import { DELETE, GET, POST } from "./route";

type Read = { data?: unknown; error?: unknown };

/**
 * 假 Supabase 客户端：按「表名 + 该表第几次读取」返回预置结果。
 *
 * 同一次请求里对 `team_members` 有好几道读取（归属 / 我的角色 / 对方是否已是成员），
 * 顺序由路由决定，所以这里按序取而不是一次性匹配，好让用例能指名道姓地让某一道读失败。
 */
function fakeClient(script: Record<string, Read[]>) {
  const seen = new Map<string, number>();
  const forTable = (table: string) => {
    const builder: Record<string, unknown> = {};
    const step = () => {
      const index = seen.get(table) ?? 0;
      seen.set(table, index + 1);
      return Promise.resolve(script[table]?.[index] ?? { data: null, error: null });
    };
    for (const method of ["select", "eq", "order", "limit", "in", "insert", "delete"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(step);
    builder.single = vi.fn(step);
    return builder;
  };
  return { from: vi.fn(forTable), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
}

function request(url: string, body?: unknown) {
  return new NextRequest(`https://indiestack.test${url}`, {
    method: body ? "POST" : url.includes("?") ? "GET" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const INVITE_BODY = { email: "Invited@Example.com", role: "member" };

/** 一路读到底都成功的最小脚本：我有团队、我是 admin、对方存在、对方还不是成员。 */
const HAPPY: Record<string, Read[]> = {
  team_members: [
    { data: { team_id: "t1" } },
    { data: { role: "admin" } },
    { data: null },
    { data: { id: "m9" } },
  ],
  profiles: [{ data: { id: "u2" } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({
    success: true,
    data: { id: "u1", email: "a@b.com", role: "admin" },
  });
  notifyUserMock.mockResolvedValue(undefined);
  syncCountMock.mockResolvedValue("synced");
  adminMock.mockImplementation(() => fakeClient(HAPPY));
});

function wire(script: Record<string, Read[]>, adminScript = script) {
  clientMock.mockResolvedValue(fakeClient(script));
  adminMock.mockImplementation(() => fakeClient(adminScript));
}

describe("POST /api/invitations", () => {
  it("四道读取都正常时发出邀请", async () => {
    wire(HAPPY);
    const response = await POST(request("/api/invitations", INVITE_BODY));
    expect(response.status).toBe(201);
    expect(notifyUserMock).toHaveBeenCalled();
    expect(logApiErrorMock).not.toHaveBeenCalled();
  });

  it.each([
    ["发起人团队归属", 0, "Could not read your team membership", "No team found"],
    ["发起人在该团队的角色", 1, "Could not verify your team role", "Only team admins can invite members"],
    ["对方是否已是成员", 2, "Could not check existing membership", "User is already a team member"],
  ])("%s 读失败时是 503，不能答成「没有团队 / 没有权限 / 还不是成员」", async (_name, index, retry, lies) => {
    const boom = structuredClone(HAPPY);
    boom.team_members[index] = { data: null, error: { message: "connection terminated" } };
    wire(boom);

    const response = await POST(request("/api/invitations", INVITE_BODY));
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(503);
    expect(payload.error).toContain(retry);
    expect(payload.error).not.toContain(lies);
    expect(logApiErrorMock).toHaveBeenCalled();
    // 没确认之前绝不能往下写：插入一次都不该发生。
    expect(notifyUserMock).not.toHaveBeenCalled();
  });

  it("「确实没有团队」仍然是 404，与读失败是两件事", async () => {
    const none = structuredClone(HAPPY);
    none.team_members[0] = { data: null };
    wire(none);
    const response = await POST(request("/api/invitations", INVITE_BODY));
    await expect(response.json()).resolves.toEqual({ error: "No team found" });
    expect(response.status).toBe(404);
    expect(logApiErrorMock).not.toHaveBeenCalled();
  });

  it("「确实不是管理员」仍然是 403", async () => {
    const notAdmin = structuredClone(HAPPY);
    notAdmin.team_members[1] = { data: { role: "member" } };
    wire(notAdmin);
    const response = await POST(request("/api/invitations", INVITE_BODY));
    await expect(response.json()).resolves.toEqual({
      error: "Only team admins can invite members",
    });
    expect(response.status).toBe(403);
  });

  it("「确实还没有账号」仍然是 404，读不到人时才是 503", async () => {
    const missing = structuredClone(HAPPY);
    missing.profiles = [{ data: null }];
    wire(missing);
    const gone = await POST(request("/api/invitations", INVITE_BODY));
    const gonePayload = (await gone.json()) as { error: string };
    expect(gone.status).toBe(404);
    expect(gonePayload.error).toContain("User not found");
    expect(gonePayload.error).not.toContain("retry");

    const boom = structuredClone(HAPPY);
    boom.profiles = [{ data: null, error: { message: "could not parse response" } }];
    wire(boom);
    const failed = await POST(request("/api/invitations", INVITE_BODY));
    await expect(failed.json()).resolves.toMatchObject({
      error: "Could not look up that user. Please retry.",
    });
    expect(failed.status).toBe(503);
  });

  it("邮箱按小写给库，否则大小写不同就查不到已有账号", async () => {
    const seen: string[] = [];
    const capture = fakeClient(HAPPY);
    const original = capture.from;
    capture.from = vi.fn((table: string) => {
      const builder = original(table);
      const eq = builder.eq as ReturnType<typeof vi.fn>;
      builder.eq = vi.fn((column: string, value: unknown) => {
        if (table === "profiles" && column === "email") seen.push(String(value));
        return builder;
      });
      return builder;
    }) as typeof capture.from;
    clientMock.mockResolvedValue(capture);
    adminMock.mockImplementation(() => capture);

    await POST(request("/api/invitations", INVITE_BODY));
    expect(seen).toEqual(["invited@example.com"]);
  });
});

describe("DELETE /api/invitations", () => {
  it("目标成员读失败时 503，而不是「Member not found」", async () => {
    wire({ team_members: [{ data: null, error: { message: "timeout" } }] });
    const response = await DELETE(request("/api/invitations?id=m1"));
    await expect(response.json()).resolves.toMatchObject({
      error: "Could not read that team member. Please retry.",
    });
    expect(response.status).toBe(503);
  });

  it("操作人角色读失败时 503，而不是「只有管理员能移除」", async () => {
    wire({
      team_members: [
        { data: { team_id: "t1", role: "member" } },
        { data: null, error: { message: "too-many-requests" } },
      ],
    });
    const response = await DELETE(request("/api/invitations?id=m1"));
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(503);
    expect(payload.error).toContain("Could not verify your team role");
    expect(payload.error).not.toContain("Only team admins");
  });

  it("确实查不到这一行时仍然 404，确实是普通成员时仍然 403", async () => {
    wire({ team_members: [{ data: null }] });
    const gone = await DELETE(request("/api/invitations?id=m1"));
    await expect(gone.json()).resolves.toEqual({ error: "Member not found" });
    expect(gone.status).toBe(404);

    wire({
      team_members: [
        { data: { team_id: "t1", role: "member" } },
        { data: { role: "member" } },
      ],
    });
    const denied = await DELETE(request("/api/invitations?id=m1"));
    await expect(denied.json()).resolves.toEqual({
      error: "Only team admins can remove members",
    });
    expect(denied.status).toBe(403);
  });

  it("缺少 id 时 400，且一次读取都不发生", async () => {
    const client = fakeClient({});
    const spy = client.from;
    clientMock.mockResolvedValue(client);
    const response = await DELETE(request("/api/invitations"));
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("GET /api/invitations", () => {
  it("成员身份读失败时 503，而不是把没有变过的权限答成 403", async () => {
    wire({ team_members: [{ data: null, error: { message: "connection reset" } }] });
    const response = await GET(request("/api/invitations?team_id=t1"));
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(503);
    expect(payload.error).toContain("Could not verify your team membership");
    expect(payload.error).not.toContain("Forbidden");
  });

  it("确实不属于该团队时才是 403", async () => {
    wire({ team_members: [{ data: null }] });
    const response = await GET(request("/api/invitations?team_id=t1"));
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
    expect(response.status).toBe(403);
  });

  it("没带 team_id 时 400", async () => {
    clientMock.mockResolvedValue(fakeClient({}));
    await expect(GET(request("/api/invitations")).then((r) => r.status)).resolves.toBe(400);
  });
});
