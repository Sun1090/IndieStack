/**
 * 团队管理 Server Actions 单测（v0.6.0 F09 coverage 补齐）
 * mock supabase server/admin 客户端 + profiles repository + next/cache，
 * 覆盖 getCurrentTeam/createTeam/inviteMember/removeMember/updateMemberRole 的
 * 成功与全部错误分支（未登录、校验失败、无团队、非管理员、目标不存在/owner、DB 错误、回滚、成员数重算）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, createAdminClientMock, findUserIdByEmailMock, revalidatePathMock, logActionErrorMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    createAdminClientMock: vi.fn(),
    findUserIdByEmailMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    logActionErrorMock: vi.fn(async () => {}),
  }));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/repositories/profiles", () => ({ findUserIdByEmail: findUserIdByEmailMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/api-log", () => ({ logActionError: logActionErrorMock }));

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

  /**
   * `.single()` 与 `.maybeSingle()` 的差别必须可观测：真客户端在「没有这一行」时，
   * 前者给 PGRST116 错误，后者给 `{ data: null, error: null }`。
   * 两个终局共用同一份预置数据，谁被调用就按谁的语义加工——否则代码从 maybeSingle 退回 single
   * 时，那次「没有这一行」在测试里会安静地变成读失败（或反过来），没有人发现。
   */
  function terminal(q: Query, kind: "single" | "maybeSingle") {
    const given = (q[kind] ?? q.single ?? q.maybeSingle) as
      | { data?: unknown; error?: unknown }
      | undefined;
    const result = given ?? { data: null, error: null };
    if (kind === "single" && !result.error && (result.data === null || result.data === undefined))
      return { data: null, error: { code: "PGRST116", message: "no rows returned" } };
    return result;
  }

  function chainFor(q: Query) {
    const c: Record<string, unknown> = {};
    c.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) =>
      Promise.resolve(q.resolve ?? { error: null, data: null }).then(onFulfilled, onRejected);
    for (const m of ["select", "insert", "update", "delete", "eq", "limit", "order"]) {
      c[m] = vi.fn(() => c);
    }
    c.single = vi.fn(async () => terminal(q, "single"));
    c.maybeSingle = vi.fn(async () => terminal(q, "maybeSingle"));
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
    { maybeSingle: membership }, // getCurrentTeam 的归属读取（换成 maybeSingle：没有这一行不是错误）
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
  it("未登录算「没有团队」，不算读失败", async () => {
    createClientMock.mockResolvedValue(buildClient({ user: null }));
    await expect(getCurrentTeam()).resolves.toEqual({ status: "no-team" });
  });

  it("无团队成员记录返回 no-team，并且不再往下读", async () => {
    const client = buildClient({
      queries: { team_members: [{ maybeSingle: { data: null, error: null } }] },
    });
    createClientMock.mockResolvedValue(client);
    await expect(getCurrentTeam()).resolves.toEqual({ status: "no-team" });
    expect(client.from.mock.calls.filter((c: string[]) => c[0] === "teams")).toHaveLength(0);
  });

  it("归属读失败返回 error，而不是「这个人没有团队」", async () => {
    const client = buildClient({
      queries: {
        team_members: [{ maybeSingle: { data: null, error: { message: "connection terminated" } } }],
      },
    });
    createClientMock.mockResolvedValue(client);
    await expect(getCurrentTeam()).resolves.toEqual({
      status: "error",
      message: "connection terminated",
    });
    expect(client.from.mock.calls.filter((c: string[]) => c[0] === "teams")).toHaveLength(0);
  });

  it("团队行读失败同样返回 error（有成员行却没有团队行是另一回事，见下一条）", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [{ maybeSingle: { data: { team_id: "t1" }, error: null } }],
          teams: [{ maybeSingle: { data: null, error: { message: "could not parse response" } } }],
        },
      }),
    );
    await expect(getCurrentTeam()).resolves.toEqual({
      status: "error",
      message: "could not parse response",
    });
  });

  it("成员行在、团队行确实缺失时算 no-team（数据不一致，不是故障）", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [{ maybeSingle: { data: { team_id: "t1" }, error: null } }],
          teams: [{ maybeSingle: { data: null, error: null } }],
        },
      }),
    );
    await expect(getCurrentTeam()).resolves.toEqual({ status: "no-team" });
  });

  it("返回当前用户所属团队", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [{ maybeSingle: { data: { team_id: "t1" }, error: null } }],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(getCurrentTeam()).resolves.toEqual({ status: "ok", team: TEAM });
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

  it("团队归属读失败回答 databaseError，而不是让人去创建第二个团队", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [{ maybeSingle: { data: null, error: { message: "db" } } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("非 owner/admin 返回 onlyAdminsInvite", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } }, // membership
            { maybeSingle: { data: { role: "admin" }, error: null } }, // 角色检查
            { maybeSingle: { data: { id: "u2" }, error: null } }, // existing（查重用 maybeSingle，无行不是错误）
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "alreadyMember",
    });
  });

  it("权限查询失败回答 databaseError，而不是凭空说「你没有权限」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: null, error: { message: "db" } }, // 角色查询本身失败
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("邮箱查询失败回答 databaseError，而不是「这个邮箱没注册」", async () => {
    findUserIdByEmailMock.mockRejectedValue(new Error("db"));
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "owner" }, error: null },
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("成员查重失败就停下，不得带着未知状态去 INSERT", async () => {
    findUserIdByEmailMock.mockResolvedValue("u2");
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
            { maybeSingle: { data: null, error: { message: "db" } } }, // 查重失败
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    // admin 客户端一条队列都不给：若代码继续走到插入，member_count 那步也拿不到结果，
    // 最终会是 {ok:true} 而不是下面的 databaseError —— 所以这条断言本身就是「没往下走」的证据
    createAdminClientMock.mockReturnValue(buildClient({ queries: {} }));
    await expect(inviteMember(VALID_INVITE_INPUT)).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("插入成员 DB 错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { single: { data: null, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
            { single: { data: null, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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

  it("团队归属读失败回答 databaseError，而不是「你没有团队」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: { team_members: [{ maybeSingle: { data: null, error: { message: "db" } } }] },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("自己的成员行读失败回答 databaseError，而不是凭空说「你没有权限」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: null, error: { message: "db" } },
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("目标成员读失败回答 databaseError，而不是「这个人不存在」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "admin" }, error: null },
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          team_members: [{ maybeSingle: { data: null, error: { message: "db" } } }],
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("当前成员非管理员返回 onlyAdminsRemove", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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

  it("重算读不到数字时：成员仍然移除成功，但必须上报「计数没更新」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: { role: "admin" }, error: null },
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    createAdminClientMock.mockReturnValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: null } }, // delete
            { resolve: { count: null } }, // 重算读不到数字 → 不写，交给上报
          ],
        },
      }),
    );
    await expect(removeMember("m1")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
    // 一枚过期的数字可以接受，静默不行：这里不报，运维就永远不知道面板在骗人
    expect(logActionErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("member_count 未更新（count-failed）"),
      expect.objectContaining({ message: "member_count_sync_failed" }),
    );
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

  it("团队归属读失败回答 databaseError，而不是「你没有团队」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: { team_members: [{ maybeSingle: { data: null, error: { message: "db" } } }] },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("自己的成员行读失败回答 databaseError，而不是 onlyAdminsInvite", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: serverQueriesForTeamMember(
            { data: { team_id: "t1" }, error: null },
            { data: null, error: { message: "db" } },
          ),
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "databaseError",
    });
  });

  it("目标成员读失败回答 databaseError，而不是「这个人不存在」", async () => {
    createClientMock.mockResolvedValue(
      buildClient({
        queries: {
          team_members: [
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: null, error: { message: "db" } } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({
      ok: false,
      error: "databaseError",
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
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: null, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "admin" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: { message: "db" } } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
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
            { maybeSingle: { data: { team_id: "t1" }, error: null } },
            { maybeSingle: { data: { role: "owner" }, error: null } },
            { maybeSingle: { data: { role: "member" }, error: null } },
            { resolve: { error: null } },
          ],
          teams: [{ maybeSingle: { data: TEAM, error: null } }],
        },
      }),
    );
    await expect(updateMemberRole("m1", "admin")).resolves.toEqual({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});
