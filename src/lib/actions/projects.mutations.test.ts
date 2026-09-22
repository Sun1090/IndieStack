/**
 * 项目删除/更新 Action 测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteProject, updateProject } from "./projects";

const { removeMock, extractKeyMock } = vi.hoisted(() => ({
  removeMock: vi.fn(async (_key?: string) => undefined),
  extractKeyMock: vi.fn<(url: string | null, prefix: string, tenant: string) => string | null>(
    () => null,
  ),
}));

vi.mock("@/lib/storage", () => ({
  getStorageDriver: () => ({ remove: removeMock }),
  extractManagedObjectKey: extractKeyMock,
  cleanupManagedStorageUrl: vi.fn(async (url: string | null, prefix: string, tenant: string) => {
    const key = extractKeyMock(url, prefix, tenant);
    if (!key) return false;
    await removeMock(key);
    return true;
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockState = vi.hoisted(() => ({
  user: null as unknown,
  project: null as { team_id: string; logo_url: string | null } | null,
  membershipRole: null as string | null,
  updateError: null as { message: string } | null,
  deleteError: null as { message: string } | null,
  // 三条读查询各自的可注入失败：`projectError` 是项目行、`membershipError` 是身份行、
  // `configError` / `config` 是合并写入前要读回来的那份 config。
  projectError: null as { message: string } | null,
  membershipError: null as { message: string } | null,
  config: null as Record<string, unknown> | null,
  configError: null as { message: string } | null,
  lastUpdatePayload: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockState.user } }) },
    from: (table: string) => {
      if (table === "projects") {
        return {
          // 按选择的列分派：`select("config")` 与 `select("team_id…")` 读的是不同的行形状，
          // 混成一条会让 config 合并那条路径永远测不到（原本就是零覆盖）。
          select: (columns: string) => ({
            eq: () => ({
              maybeSingle: async () =>
                columns === "config"
                  ? {
                      data: mockState.configError ? null : { config: mockState.config },
                      error: mockState.configError,
                    }
                  : { data: mockState.project, error: mockState.projectError },
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            mockState.lastUpdatePayload = payload;
            return { eq: async () => ({ error: mockState.updateError }) };
          },
          delete: () => ({
            eq: async () => ({ error: mockState.deleteError }),
          }),
        };
      }
      // team_members
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: mockState.membershipRole ? { role: mockState.membershipRole } : null,
                error: mockState.membershipError,
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

beforeEach(() => {
  mockState.user = { id: "u1" };
  mockState.project = { team_id: "t1", logo_url: null };
  extractKeyMock.mockReturnValue(null);
  mockState.membershipRole = "owner";
  mockState.updateError = null;
  mockState.deleteError = null;
  mockState.projectError = null;
  mockState.membershipError = null;
  mockState.config = null;
  mockState.configError = null;
  mockState.lastUpdatePayload = null;
});

describe("deleteProject()", () => {
  it("未登录返回 notAuthenticated", async () => {
    mockState.user = null;
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("项目不存在返回 projectNotFound", async () => {
    mockState.project = null;
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "projectNotFound" });
  });

  it("非 admin 返回 onlyAdminsCreateProject", async () => {
    mockState.membershipRole = "member";
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "onlyAdminsCreateProject" });
  });

  it("owner 删除成功返回 ok", async () => {
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: true });
  });

  it("数据库错误返回 databaseError", async () => {
    mockState.deleteError = { message: "db" };
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "databaseError" });
  });

  it("项目行读取失败返回 databaseError，而不是「项目不存在」", async () => {
    mockState.projectError = { message: "connection terminated" };
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "databaseError" });
  });

  it("成员身份读取失败返回 databaseError，而不是「只有管理员能操作」", async () => {
    mockState.membershipError = { message: "connection terminated" };
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: false, error: "databaseError" });
  });

  it("删除成功后清理当前项目的受管封面", async () => {
    extractKeyMock.mockReturnValue("covers/p1/old.webp");
    mockState.project = { team_id: "t1", logo_url: "https://cdn.example/covers/p1/old.webp" };
    const result = await deleteProject("p1");
    expect(result).toEqual({ ok: true });
    expect(removeMock).toHaveBeenCalledWith("covers/p1/old.webp");
  });
});

describe("updateProject()", () => {
  it("空名称返回 projectNameRequired", async () => {
    const result = await updateProject("p1", { name: "   " });
    expect(result).toEqual({ ok: false, error: "projectNameRequired" });
  });

  it("非 admin 返回 onlyAdminsCreateProject", async () => {
    mockState.membershipRole = "viewer";
    const result = await updateProject("p1", { name: "New" });
    expect(result).toEqual({ ok: false, error: "onlyAdminsCreateProject" });
  });

  it("项目行读取失败返回 databaseError，而不是「项目不存在」", async () => {
    mockState.projectError = { message: "connection terminated" };
    const result = await updateProject("p1", { name: "New" });
    expect(result).toEqual({ ok: false, error: "databaseError" });
  });

  it("成员身份读取失败返回 databaseError，而不是「只有管理员能操作」", async () => {
    mockState.membershipError = { message: "connection terminated" };
    const result = await updateProject("p1", { name: "New" });
    expect(result).toEqual({ ok: false, error: "databaseError" });
  });

  it("config 合并保留未提交的其他键", async () => {
    mockState.config = { webhook: "https://example.test", theme: "dark" };
    const result = await updateProject("p1", { config: { theme: "light" } });
    expect(result).toEqual({ ok: true });
    expect(mockState.lastUpdatePayload?.config).toEqual({
      webhook: "https://example.test",
      theme: "light",
    });
  });

  it("config 读取失败时中止更新，而不是拿空对象合并掉其他键", async () => {
    mockState.configError = { message: "connection terminated" };
    const result = await updateProject("p1", { config: { theme: "light" } });
    expect(result).toEqual({ ok: false, error: "databaseError" });
    // 关键断言：一次都没写。写下去就会把 webhook 这类没提交的键一起抹掉。
    expect(mockState.lastUpdatePayload).toBeNull();
  });

  it("更新成功返回 ok", async () => {
    const result = await updateProject("p1", { name: "Renamed" });
    expect(result).toEqual({ ok: true });
  });
});
