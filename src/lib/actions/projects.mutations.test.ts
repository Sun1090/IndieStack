/**
 * 项目删除/更新 Action 测试
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteProject, updateProject } from "./projects";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockState = vi.hoisted(() => ({
  user: null as unknown,
  project: null as { team_id: string } | null,
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
  mockState.project = { team_id: "t1" };
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
