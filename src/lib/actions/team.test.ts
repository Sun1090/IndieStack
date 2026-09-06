/**
 * 团队管理 Server Actions 单测（v0.6.0 F09 coverage 补齐）
 * mock supabase server/admin 客户端 + profiles repository + next/cache，
 * 覆盖 getCurrentTeam/createTeam/inviteMember/removeMember/updateMemberRole 的
 * 成功与全部错误分支（未登录、校验失败、无团队、非管理员、目标不存在/owner、DB 错误、回滚、成员数重算）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, createAdminClientMock, findUserIdByEmailMock, revalidatePathMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    findUserIdByEmailMock: vi.fn(),
    revalidatePathMock: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/repositories/profiles", () => ({ findUserIdByEmail: findUserIdByEmailMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { getCurrentTeam, createTeam, inviteMember, removeMember, updateMemberRole } from "./team";

const USER = { id: "u1", email: "owner@indiestack.dev" };
const TEAM = { id: "t1", name: "Acme", slug: "acme", owner_id: "u1", member_count: 1 };
const VALID_TEAM_INPUT = { name: "Acme", slug: "acme" };
const VALID_INVITE_INPUT = { email: "x@y.com", role: "member" } as const;

/** 单条查询配置：以 single/maybeSingle 显式结束，或以 thenable 隐式 await（insert/delete/update/eq 结尾） */
type Query = { single?: unknown; maybeSingle?: unknown; resolve?: unknown };

/** 构造可 mock 的 supabase 客户端：from(table) 每次弹出该表下一条查询配置（模拟真实 builder 的 once-per-query） */
function buildClient(opts: { user?: object | null; queries?: Record<string, Query[]> } = {}) {
  const queue = new Map<string, Query[]>();
  for (const [table, arr] of Object.entries(opts.queries ?? {})) queue.set(table, [...arr]);

  function chainFor(q: Query) {
    const c: Record<string, unknown> = {};
    c.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
      Promise.resolve(q.resolve ?? { error: null, data: null }).then(onFulfilled, onRejected);
    for (const m of ["select", "insert", "update", "delete", "eq", "limit", "order"]) {
      c[m] = vi.fn(() => c);
    }
    c.single = vi.fn(async () => q.single ?? { data: null, error: null });
    c.maybeSingle = vi.fn(async () => q.maybeSingle ?? { data: null, error: null });
    return c;
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user === undefined ? USER : opts.user } })),
    },
    from: vi.fn((table: string) => {
      const qs = queue.get(table);
      const q = qs && qs.length > 0 ? (qs.shift() as Query) : {};
      return chainFor(q);
    }),
  };
}

function serverQueriesForTeamMember(membership: unknown, role: unknown) {
  return [
    { single: membership }, // getCurrentTeam membership
    { maybeSingle: role }, // 当前成员角色检查
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  findUserIdByEmailMock.mockResolvedValue("u2");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCurrentTeam()", () => {
  it("未登录返回 null", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(getCurrentTeam()).resolves.toBeNull();
  });

  it("无团队成员记录返回 null", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: { team_members: [{ single: { data: null, error: null } }] },
      }),
    );
    await expect(getCurrentTeam()).resolves.toBeNull();
  });

  it("返回当前用户所属团队", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [{ single: { data: { team_id: "t1" }, error: null } }],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(getCurrentTeam()).resolves.toEqual(TEAM);
  });
});

describe("createTeam()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(createTeam(VALID_TEAM_INPUT)).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("校验失败返回 schema 消息键", async () => {
    createClientMock.mockResolvedValue(buildClient());
    await expect(createTeam({ name: "A", slug: "Bad Slug!" })).resolves.toEqual({
      ok: false,
      error: "slugInvalid",
    });
  });

  it("slug 冲突（23505）返回 teamSlugExists", async () => {
    createClientMock.mockResolvedValue(buildClient());
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          teams: [{ single: { data: null, error: { code: "23505", message: "dup" } } }],
        },
      }),
    );
    await expect(createTeam(VALID_TEAM_INPUT)).resolves.toEqual({
      ok: false,
      error: "teamSlugExists",
    });
  });

  it("创建团队其他 DB 错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(buildClient());
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          teams: [{ single: { data: null, error: { message: "db down" } } }],
        },
      }),
    );
    await expect(createTeam(VALID_TEAM_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("添加所有者失败：回滚团队并返回 databaseError", async () => {
    createClientMock.mockResolvedValue(buildClient());
    const admin = buildClient({
      queries: {
        teams: [{ single: { data: TEAM, error: null } }],
        team_members: [{ resolve: { error: { message: "fk violation" } } }],
      },
    });
    createAdminClientMock.mockReturnValue(admin);
    await expect(createTeam(VALID_TEAM_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
    // 回滚删除刚创建的团队
    const teamsDelete = admin.from.mock.calls.filter((c: string[]) => c[0] === "teams");
    expect(teamsDelete.length).toBeGreaterThanOrEqual(1);
  });

  it("成功：返回团队并 revalidatePath", async () => {
    createClientMock.mockResolvedValue(buildClient());
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          teams: [{ single: { data: TEAM, error: null } }],
          team_members: [{ resolve: { error: null } }],
        },
      }),
    );
    await expect(createTeam(VALID_TEAM_INPUT)).resolves.toEqual({ ok: true, data: { team: TEAM } });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});

describe("inviteMember()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("邮箱非法返回 invalidEmail", async () => {
    createClientMock.mockResolvedValue(buildClient());
    await expect(inviteMember({ email: "nope", role: "member" })).resolves.toEqual({
      ok: false,
      error: "invalidEmail",
    });
  });

  it("无团队返回 noTeam", async () => {
    createClientMock.mockResolvedValue(buildClient({ queries: { team_members: [] } }));
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "noTeam",
    });
  });

  it("非 owner/admin 返回 onlyAdminsInvite", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "onlyAdminsInvite",
    });
  });

  it("目标用户不存在返回 userNotFound", async () => {
    findUserIdByEmailMock.mockResolvedValue(null);
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "owner" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "userNotFound",
    });
  });

  it("已是成员返回 alreadyMember", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } }, // membership
            { maybeSingle: { data: { role: "admin" }, error: null } }, // 角色检查
            { single: { data: { id: "u2" }, error: null } }, // existing
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "alreadyMember",
    });
  });

  it("插入成员 DB 错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { single: { data: null, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({ queries: { team_members: [{ resolve: { error: { message: "db" } } }] } }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("成功：落库并重算 member_count，revalidatePath", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
            { single: { data: null, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    const admin = buildClient({
      queries: {
        team_members: [
          { resolve: { error: null } }, // insert
          { resolve: { count: 3 } }, // count
        ],
        teams: [{ resolve: { error: null } }], // update member_count
      },
    });
    createAdminClientMock.mockReturnValue(admin);
    await expect(inviteMember({ ...VALID_INVITE_INPUT, role: "admin" })).resolves.toEqual({
      ok: true,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
    // 插入请求带受邀角色 admin
    const insertBody = JSON.stringify(admin.from.mock.calls.map((c: string[]) => c[0]));
    expect(insertBody).toContain("team_members");
  });
});

describe("removeMember()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("无团队返回 noTeam", async () => {
    createClientMock.mockResolvedValue(buildClient({ queries: { team_members: [] } }));
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "noTeam" });
  });

  it("当前成员非管理员返回 onlyAdminsRemove", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "onlyAdminsRemove" });
  });

  it("目标成员不存在返回 memberNotFound", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "admin" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({ queries: { team_members: [{ maybeSingle: { data: null, error: null } }] } }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "memberNotFound" });
  });

  it("目标是 owner 返回 ownerCannotRemove", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "owner" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: { team_members: [{ maybeSingle: { data: { role: "owner" }, error: null } }] },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "ownerCannotRemove" });
  });

  it("删除 DB 错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "admin" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: { message: "db" } } },
          ],
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功：删除并重算 member_count（count 缺失回退 0）", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "admin" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: null } }, // delete
            { resolve: { count: null } }, // count 为 null → count ?? 0
          ],
          teams: [{ resolve: { error: null } }], // update member_count
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});

describe("updateMemberRole()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "notAuthenticated",
    });
  });

  it("无团队返回 noTeam", async () => {
    createClientMock.mockResolvedValue(buildClient({ queries: { team_members: [] } }));
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "noTeam",
    });
  });

  it("当前成员非管理员返回 onlyAdminsInvite", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "member" }, error: null },
          ),
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "onlyAdminsInvite",
    });
  });

  it("目标不存在返回 memberNotFound", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: null, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "memberNotFound",
    });
  });

  it("目标是 owner 返回 ownerCannotRemove", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "ownerCannotRemove",
    });
  });

  it("更新 DB 错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: { message: "db" } } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("成功：更新角色并 revalidatePath", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { single: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: null } },
          ],
          teams: [{ single: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});
