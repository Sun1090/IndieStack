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
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mockState.user } }) },
    from: (table: string) => {
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockState.project }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: mockState.updateError }),
          }),
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

  it("更新成功返回 ok", async () => {
    const result = await updateProject("p1", { name: "Renamed" });
    expect(result).toEqual({ ok: true });
  });
});
