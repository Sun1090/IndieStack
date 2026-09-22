/**
 * teams repository 单测（#35：派生缓存不能靠猜）
 *
 * `teams.member_count` 没有触发器兜底（迁移 007 明写「由服务端重算写入」），
 * 所以它的两种合法状态是「等于真实行数」或「保持旧值」。这里锁的就是第三种：
 * 读不到数字时**一条 UPDATE 都不许发出去**。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chainMock, dbClientMock } from "./test-helpers";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { syncTeamMemberCount } from "./teams";

beforeEach(() => {
  vi.clearAllMocks();
});

/** 给一张表配一条链；返回该链以便断言它被怎样调用过。 */
function clientWith(chains: Record<string, ReturnType<typeof chainMock>>) {
  return dbClientMock((table) => chains[table]);
}

describe("syncTeamMemberCount()", () => {
  it("读到真实行数时按该数字写回", async () => {
    const members = chainMock({ count: 7 });
    const teams = chainMock({ error: null });
    createAdminClientMock.mockReturnValue(clientWith({ team_members: members, teams }));

    await expect(syncTeamMemberCount("t1")).resolves.toBe("synced");
    expect(teams.update).toHaveBeenCalledWith({ member_count: 7 });
    expect(teams.eq).toHaveBeenCalledWith("id", "t1");
  });

  it("重算查询失败时不发任何 UPDATE（旧值胜过猜出来的 0/1）", async () => {
    const members = chainMock({ error: { message: "db" } });
    const teams = chainMock({ error: null });
    createAdminClientMock.mockReturnValue(clientWith({ team_members: members, teams }));

    await expect(syncTeamMemberCount("t1")).resolves.toBe("count-failed");
    expect(teams.update).not.toHaveBeenCalled();
  });

  it("provider 没回 count（null）同样算读不到，而不是读到一个 0 人团队", async () => {
    const members = chainMock({ count: null });
    const teams = chainMock({ error: null });
    createAdminClientMock.mockReturnValue(clientWith({ team_members: members, teams }));

    await expect(syncTeamMemberCount("t1")).resolves.toBe("count-failed");
    expect(teams.update).not.toHaveBeenCalled();
  });

  it("写回失败要说得清是「写坏了」而不是「没读到」", async () => {
    const members = chainMock({ count: 3 });
    const teams = chainMock({ error: { message: "rls" } });
    createAdminClientMock.mockReturnValue(clientWith({ team_members: members, teams }));

    await expect(syncTeamMemberCount("t1")).resolves.toBe("write-failed");
    expect(teams.update).toHaveBeenCalledWith({ member_count: 3 });
  });

  it("真实人数为 0 时写的是 0，不能和「读不到」混成同一条路径", async () => {
    const members = chainMock({ count: 0 });
    const teams = chainMock({ error: null });
    createAdminClientMock.mockReturnValue(clientWith({ team_members: members, teams }));

    await expect(syncTeamMemberCount("t1")).resolves.toBe("synced");
    expect(teams.update).toHaveBeenCalledWith({ member_count: 0 });
  });
});
