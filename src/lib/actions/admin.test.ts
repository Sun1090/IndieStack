/**
 * 管理后台服务端操作单元测试
 * mock guards 的 safelyRequireRole 与 admin client，验证用户列表、角色更新、审计日志逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { safelyRequireRoleMock, createAdminClientMock, revalidatePathMock } = vi.hoisted(() => ({
  safelyRequireRoleMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ safelyRequireRole: safelyRequireRoleMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { listAdminUsers, updateUserRole, listAuditLogs } from "./admin";

const AUTH = { success: true, data: { id: "u1", email: "a@b.com", role: "admin" as const } };

function unauthorized() {
  return { success: false, error: { code: "UNAUTHORIZED" } };
}
function forbidden() {
  return { success: false, error: { code: "FORBIDDEN" } };
}

/** 链式 mock：支持 select/eq/order/limit/update/maybeSingle，按调用序列解析 */
function tableChain(resolver: (seq: Array<[string, unknown[]]>) => { value: unknown }) {
  const seq: Array<[string, unknown[]]> = [];
  const call = (m: string, ...a: unknown[]) => {
    seq.push([m, a]);
    return obj;
  };
  const obj: Record<string, unknown> = {
    select: (...a: unknown[]) => call("select", ...a),
    eq: (...a: unknown[]) => call("eq", ...a),
    order: (...a: unknown[]) => call("order", ...a),
    limit: (...a: unknown[]) => call("limit", ...a),
    update: (...a: unknown[]) => call("update", ...a),
    range: (...a: unknown[]) => call("range", ...a),
  };
  obj.maybeSingle = () => Promise.resolve(resolver(seq).value);
  obj.then = (r: (v: unknown) => unknown) => r(resolver(seq).value);
  return obj as Record<string, (...a: unknown[]) => unknown> & {
    maybeSingle: () => Promise<unknown>;
    then: (r: (v: unknown) => unknown) => unknown;
  };
}

function adminClient(factory: (table: string) => ReturnType<typeof tableChain>) {
  // 每次 from() 返回新的链式 mock，避免同一张表的多次查询共用调用序列
  return { from: vi.fn((table: string) => factory(table)) };
}

function profilesChain(opts: {
  rows?: Array<Record<string, unknown>>;
  error?: unknown;
  target?: { role: string } | null;
  updateError?: unknown;
}) {
  const { rows = [], error = null, target = { role: "member" }, updateError = null } = opts;
  return tableChain((seq) => {
    const first = seq[0];
    if (first?.[0] === "update") {
      return { value: { error: updateError } };
    }
    if (first?.[1]?.[0] === "role") {
      return { value: { data: target } };
    }
    return { value: { data: rows, error } };
  });
}

function auditLogsChain(opts: { rows?: Array<Record<string, unknown>>; error?: unknown } = {}) {
  const { rows = [], error = null } = opts;
  return tableChain(() => ({ value: { data: rows, error } }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminUsers()", () => {
  function setup(
    opts: {
      auth?: unknown;
      rows?: Array<Record<string, unknown>>;
      error?: unknown;
      throwError?: boolean;
    } = {},
  ) {
    const { auth = AUTH, rows = [], error = null, throwError = false } = opts;
    safelyRequireRoleMock.mockResolvedValue(auth);
    const admin = adminClient((table) =>
      table === "profiles"
        ? profilesChain({ rows, error })
        : tableChain(() => ({ value: { data: null } })),
    );
    if (throwError)
      admin.from.mockImplementation(() => {
        throw new Error("boom");
      });
    createAdminClientMock.mockReturnValue(admin);
    return admin;
  }

  it("未登录返回 notAuthenticated", async () => {
    setup({ auth: unauthorized() });
    await expect(listAdminUsers()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("非 admin 返回 forbidden", async () => {
    setup({ auth: forbidden() });
    await expect(listAdminUsers()).resolves.toEqual({ ok: false, error: "forbidden" });
  });

  it("数据库错误返回 databaseError", async () => {
    setup({ error: { message: "db" } });
    await expect(listAdminUsers()).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功返回映射后的用户列表", async () => {
    const rows = [
      { id: "u1", email: "a@b.com", full_name: "Alice", role: "admin", created_at: "2026-01-01" },
      { id: "u2", email: null, full_name: null, role: "viewer", created_at: null },
      { id: "u3", email: "c@b.com", full_name: "Carol", role: undefined, created_at: "2026-02-01" },
    ];
    setup({ rows });
    await expect(listAdminUsers()).resolves.toEqual({
      ok: true,
      data: [
        { id: "u1", email: "a@b.com", full_name: "Alice", role: "admin", created_at: "2026-01-01" },
        { id: "u2", email: null, full_name: null, role: "viewer", created_at: "" },
        {
          id: "u3",
          email: "c@b.com",
          full_name: "Carol",
          role: "member",
          created_at: "2026-02-01",
        },
      ],
    });
  });

  it("数据库异常返回 databaseError", async () => {
    setup({ throwError: true });
    await expect(listAdminUsers()).resolves.toEqual({ ok: false, error: "databaseError" });
  });
});

describe("updateUserRole()", () => {
  function setup(
    opts: {
      auth?: unknown;
      target?: { role: string } | null;
      updateError?: unknown;
      throwError?: boolean;
    } = {},
  ) {
    const {
      auth = AUTH,
      target = { role: "member" },
      updateError = null,
      throwError = false,
    } = opts;
    safelyRequireRoleMock.mockResolvedValue(auth);
    const admin = adminClient((table) =>
      table === "profiles"
        ? profilesChain({ target, updateError })
        : tableChain(() => ({ value: { data: null } })),
    );
    if (throwError)
      admin.from.mockImplementation(() => {
        throw new Error("boom");
      });
    createAdminClientMock.mockReturnValue(admin);
    return admin;
  }

  it("未登录返回 notAuthenticated", async () => {
    setup({ auth: unauthorized() });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "notAuthenticated",
    });
  });

  it("非 admin 返回 forbidden", async () => {
    setup({ auth: forbidden() });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "forbidden",
    });
  });

  it("目标用户不存在返回 userNotFoundAdmin", async () => {
    setup({ target: null });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "userNotFoundAdmin",
    });
  });

  it("不能修改 super_admin 返回 superAdminOnly", async () => {
    setup({ target: { role: "super_admin" } });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "superAdminOnly",
    });
  });

  it("数据库错误返回 databaseError", async () => {
    setup({ updateError: { message: "db" } });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "databaseError",
    });
  });

  it("成功更新并触发 revalidatePath", async () => {
    setup();
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.adminUsers);
  });

  it("数据库异常返回 databaseError", async () => {
    setup({ throwError: true });
    await expect(updateUserRole("u2", "admin")).resolves.toEqual({
      ok: false,
            error: "databaseError",
    });
  });
});

describe("listAuditLogs()", () => {
  function setup(
    opts: {
      auth?: unknown;
      rows?: Array<Record<string, unknown>>;
      error?: unknown;
      throwError?: boolean;
    } = {},
  ) {
    const {
      auth = { success: true, data: { id: "u1", email: "a@b.com", role: "super_admin" as const } },
      rows = [],
      error = null,
      throwError = false,
    } = opts;
    safelyRequireRoleMock.mockResolvedValue(auth);
    const admin = adminClient((table) =>
      table === "audit_logs"
        ? auditLogsChain({ rows, error })
        : tableChain(() => ({ value: { data: null } })),
    );
    if (throwError)
      admin.from.mockImplementation(() => {
        throw new Error("boom");
      });
    createAdminClientMock.mockReturnValue(admin);
    return admin;
  }

  it("未登录返回 notAuthenticated", async () => {
    setup({ auth: unauthorized() });
    await expect(listAuditLogs()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("非 super_admin 返回 forbidden", async () => {
    setup({ auth: forbidden() });
    await expect(listAuditLogs()).resolves.toEqual({ ok: false, error: "forbidden" });
  });

  it("数据库错误返回 databaseError", async () => {
    setup({ error: { message: "db" } });
    await expect(listAuditLogs()).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功返回审计日志列表", async () => {
    const rows = [
      {
        id: 1,
        user_id: "u1",
        action: "update_role",
        entity_type: "profile",
        entity_id: "u2",
        metadata: { role: "admin" },
        created_at: "2026-01-01",
      },
      {
        id: 2,
        user_id: null,
        action: "create",
        entity_type: "team",
        entity_id: null,
        metadata: null,
        created_at: "2026-01-02",
      },
    ];
    setup({ rows });
    await expect(listAuditLogs()).resolves.toEqual({
      ok: true,
      data: [
        {
          id: 1,
          user_id: "u1",
          action: "update_role",
          entity_type: "profile",
          entity_id: "u2",
          metadata: { role: "admin" },
          created_at: "2026-01-01",
        },
        {
          id: 2,
          user_id: null,
          action: "create",
          entity_type: "team",
          entity_id: null,
          metadata: {},
          created_at: "2026-01-02",
        },
      ],
    });
  });

  it("数据库异常返回 databaseError", async () => {
    setup({ throwError: true });
    await expect(listAuditLogs()).resolves.toEqual({ ok: false, error: "databaseError" });
  });
});
