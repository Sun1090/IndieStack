/**
 * 团队管理服务端操作单元测试
 * mock supabase server/admin client 与 next/cache，验证团队创建、邀请、移除逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, createAdminClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { getCurrentTeam, createTeam, inviteMember, removeMember } from "./team";

const USER = { id: "u1", email: "a@b.com" };
const TEAM = { id: "t1", name: "Team A", slug: "team-a", owner_id: "u1", member_count: 1 };

type Seq = Array<[string, unknown[]]>;

/** 按调用序列解析结果的链式 mock，支持同一张表的多种查询形态 */
function tableChain(
  resolver: (seq: Seq) => { value: unknown; terminal?: "single" | "maybeSingle" | "await" },
) {
  const seq: Seq = [];
  const call = (m: string, ...a: unknown[]) => {
    seq.push([m, a]);
    return obj;
  };
  const obj: Record<string, unknown> = {
    select: (...a: unknown[]) => call("select", ...a),
    eq: (...a: unknown[]) => call("eq", ...a),
    order: (...a: unknown[]) => call("order", ...a),
    limit: (...a: unknown[]) => call("limit", ...a),
    insert: (...a: unknown[]) => call("insert", ...a),
    update: (...a: unknown[]) => call("update", ...a),
    delete: (...a: unknown[]) => call("delete", ...a),
  };
  obj.single = () => Promise.resolve(resolver(seq).value);
  obj.maybeSingle = () => Promise.resolve(resolver(seq).value);
  obj.then = (r: (v: unknown) => unknown) => r(resolver(seq).value);
  return obj as Record<string, (...a: unknown[]) => unknown> & {
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    then: (r: (v: unknown) => unknown) => unknown;
  };
}

function userClient(opts: { user?: object | null } = {}) {
  const { user = USER } = opts;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(),
  };
}

/** 用户侧 team_members 链：getCurrentTeam / 角色查询 / 已有成员查询 */
function userTeamMembersChain(opts: {
  teamId?: string | null;
  role?: string | null;
  existing?: { id: string } | null;
}) {
  const { teamId = "t1", role = "owner", existing = null } = opts;
  return tableChain((seq) => {
    const selectArg = seq.find(([m]) => m === "select")?.[1]?.[0];
    if (selectArg === "team_id") {
      return { value: { data: teamId ? { team_id: teamId } : null, error: null } };
    }
    if (selectArg === "id") {
      return { value: { data: existing, error: null } };
    }
    // role 查询（maybeSingle 终端）
    return { value: { data: role ? { role } : null, error: null } };
  });
}

function userTeamsChain(opts: { team?: object | null } = {}) {
  const { team = TEAM } = opts;
  return tableChain(() => ({ value: { data: team, error: null } }));
}

function userClientFull(
  opts: {
    user?: object | null;
    team?: object | null;
    teamId?: string | null;
    role?: string | null;
    existing?: { id: string } | null;
  } = {},
) {
  const client = userClient(opts);
  // 每次 from() 都返回新的链式 mock，避免同一张表的多次查询共用调用序列
  client.from.mockImplementation((table: string) =>
    table === "teams" ? userTeamsChain(opts) : userTeamMembersChain(opts),
  );
  return client;
}

/** 管理侧 team_members 链：insert / count / target 查询 / delete */
function adminTeamMembersChain(opts: {
  insertError?: boolean;
  count?: number;
  target?: { role: string } | null;
  deleteError?: boolean;
}) {
  const { insertError = false, count = 1, target = { role: "member" }, deleteError = false } = opts;
  return tableChain((seq) => {
    const first = seq[0];
    if (first?.[0] === "insert") {
      return { value: insertError ? { error: { message: "db" } } : { error: null } };
    }
    if (first?.[0] === "delete") {
      return { value: deleteError ? { error: { message: "db" } } : { error: null } };
    }
    const selectArg = first?.[1]?.[0];
    if (selectArg === "role") {
      return { value: { data: target, error: null } };
    }
    // 统计成员数：select("*", {count:'exact', head:true}).eq() 以 await 终端结束
    return { value: { count } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentTeam()", () => {
  it("未登录返回 null", async () => {
    createClientMock.mockResolvedValue(userClient({ user: null }));
    await expect(getCurrentTeam()).resolves.toBeNull();
  });

  it("无团队成员记录返回 null", async () => {
    createClientMock.mockResolvedValue(userClientFull({ teamId: null }));
    await expect(getCurrentTeam()).resolves.toBeNull();
  });

  it("返回当前用户所属团队", async () => {
    createClientMock.mockResolvedValue(userClientFull());
    await expect(getCurrentTeam()).resolves.toEqual(TEAM);
  });
});

describe("createTeam()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(userClient({ user: null }));
    await expect(createTeam({ name: "T", slug: "t" })).resolves.toEqual({
      error: "notAuthenticated",
    });
  });

  it("空名称返回 teamNameRequired", async () => {
    createClientMock.mockResolvedValue(userClient());
    await expect(createTeam({ name: "", slug: "t" })).resolves.toEqual({
      error: "teamNameRequired",
    });
  });

  it("非法 slug 返回 slugInvalid", async () => {
    createClientMock.mockResolvedValue(userClient());
    await expect(createTeam({ name: "T", slug: "Bad Slug" })).resolves.toEqual({
      error: "slugInvalid",
    });
  });

  it("slug 冲突返回 teamSlugExists", async () => {
    createClientMock.mockResolvedValue(userClient());
    const admin = { from: vi.fn() };
    const teams = tableChain(() => ({
      value: { data: null, error: { code: "23505", message: "dup" } },
    }));
    admin.from.mockReturnValue(teams);
    createAdminClientMock.mockReturnValue(admin);
    await expect(createTeam({ name: "Team", slug: "team" })).resolves.toEqual({
      error: "teamSlugExists",
    });
  });

  it("添加所有者失败时返回 databaseError", async () => {
    createClientMock.mockResolvedValue(userClient());
    const admin = { from: vi.fn() };
    const teams = tableChain(() => ({ value: { data: TEAM, error: null } }));
    const members = tableChain(() => ({ value: { error: { message: "db" } } }));
    admin.from.mockImplementation((table: string) => (table === "teams" ? teams : members));
    createAdminClientMock.mockReturnValue(admin);
    await expect(createTeam({ name: "Team", slug: "team" })).resolves.toEqual({
      error: "databaseError",
    });
  });

  it("创建成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(userClient());
    const admin = { from: vi.fn() };
    const teams = tableChain(() => ({ value: { data: TEAM, error: null } }));
    const members = tableChain(() => ({ value: { error: null } }));
    admin.from.mockImplementation((table: string) => (table === "teams" ? teams : members));
    createAdminClientMock.mockReturnValue(admin);
    const result = await createTeam({ name: "Team A", slug: "team-a" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.team).toMatchObject({ id: "t1" });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});

describe("inviteMember()", () => {
  const input = { email: "b@example.com", role: "member" as const };

  function setup(opts: {
    role?: string | null;
    invitedProfile?: { id: string } | null;
    existing?: { id: string } | null;
    count?: number;
    insertError?: boolean;
  }) {
    const {
      role = "owner",
      invitedProfile = { id: "u2" },
      existing = null,
      count = 2,
      insertError = false,
    } = opts;
    const client = userClientFull({ role, existing });
    const admin = { from: vi.fn() };
    admin.from.mockImplementation((table: string) => {
      // 每次 from() 返回新的链，避免 insert/count/update 查询共用调用序列
      if (table === "profiles") {
        return tableChain(() => ({ value: { data: invitedProfile, error: null } }));
      }
      if (table === "team_members") return adminTeamMembersChain({ insertError, count });
      return tableChain(() => ({ value: { error: null } }));
    });
    createClientMock.mockResolvedValue(client);
    createAdminClientMock.mockReturnValue(admin);
    return { client, admin };
  }

  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(userClient({ user: null }));
    await expect(inviteMember(input)).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("非法邮箱返回 invalidEmail", async () => {
    createClientMock.mockResolvedValue(userClient());
    await expect(inviteMember({ email: "bad", role: "member" })).resolves.toEqual({
      error: "invalidEmail",
    });
  });

  it("无团队返回 noTeam", async () => {
    createClientMock.mockResolvedValue(userClientFull({ teamId: null }));
    await expect(inviteMember(input)).resolves.toEqual({ error: "noTeam" });
  });

  it("非 owner/admin 返回 onlyAdminsInvite", async () => {
    setup({ role: "member" });
    await expect(inviteMember(input)).resolves.toEqual({ error: "onlyAdminsInvite" });
  });

  it("目标用户不存在返回 userNotFound", async () => {
    setup({ invitedProfile: null });
    await expect(inviteMember(input)).resolves.toEqual({ error: "userNotFound" });
  });

  it("已在团队返回 alreadyMember", async () => {
    setup({ existing: { id: "u2" } });
    await expect(inviteMember(input)).resolves.toEqual({ error: "alreadyMember" });
  });

  it("邀请成功并触发 revalidatePath", async () => {
    setup({ count: 3 });
    await expect(inviteMember(input)).resolves.toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });
});

describe("removeMember()", () => {
  function setup(opts: {
    role?: string | null;
    target?: { role: string } | null;
    deleteError?: boolean;
    count?: number;
  }) {
    const { role = "admin", target = { role: "member" }, deleteError = false, count = 1 } = opts;
    const client = userClientFull({ role });
    const admin = { from: vi.fn() };
    admin.from.mockImplementation((table: string) =>
      table === "team_members"
        ? adminTeamMembersChain({ target, deleteError, count })
        : tableChain(() => ({ value: { error: null } })),
    );
    createClientMock.mockResolvedValue(client);
    createAdminClientMock.mockReturnValue(admin);
    return { client, admin };
  }

  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(userClient({ user: null }));
    await expect(removeMember("m1")).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("非 owner/admin 返回 onlyAdminsRemove", async () => {
    setup({ role: "member" });
    await expect(removeMember("m1")).resolves.toEqual({ error: "onlyAdminsRemove" });
  });

  it("目标成员不存在返回 memberNotFound", async () => {
    setup({ target: null });
    await expect(removeMember("m1")).resolves.toEqual({ error: "memberNotFound" });
  });

  it("不能移除 owner 返回 ownerCannotRemove", async () => {
    setup({ target: { role: "owner" } });
    await expect(removeMember("m1")).resolves.toEqual({ error: "ownerCannotRemove" });
  });

  it("移除成功并触发 revalidatePath", async () => {
    setup({ count: 1 });
    await expect(removeMember("m1")).resolves.toEqual({ success: true });
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardTeam);
  });

  it("删除失败返回 databaseError", async () => {
    setup({ deleteError: true });
    await expect(removeMember("m1")).resolves.toEqual({ error: "databaseError" });
  });
});
