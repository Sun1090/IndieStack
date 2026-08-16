/**
 * 项目管理服务端操作单元测试
 * mock supabase server client 与 next/cache，验证团队角色校验与项目创建逻辑
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ROUTES } from "@/lib/constants";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { createProject, type CreateProjectInput } from "./projects";

const USER = { id: "u1", email: "a@b.com" };
const VALID_INPUT: CreateProjectInput = {
  name: "My Project",
  slug: "my-project",
  description: "desc",
};

function mockClient(
  opts: {
    user?: object | null;
    membership?: { team_id: string; role: string } | null;
    insertError?: { code?: string; message: string } | null;
  } = {},
) {
  const { user = USER, membership = { team_id: "t1", role: "owner" }, insertError = null } = opts;
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn((table: string) => {
      if (table === "team_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve({ data: membership, error: null })),
              })),
            })),
          })),
        };
      }
      if (table === "projects") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve(
                  insertError
                    ? { data: null, error: insertError }
                    : {
                        data: {
                          id: "p1",
                          team_id: "t1",
                          name: VALID_INPUT.name,
                          slug: VALID_INPUT.slug,
                          status: "active",
                          visibility: "private",
                        },
                        error: null,
                      },
                ),
              ),
            })),
          })),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createProject()", () => {
  it("未登录返回 notAuthenticated", async () => {
    createClientMock.mockResolvedValue(mockClient({ user: null }));
    await expect(createProject(VALID_INPUT)).resolves.toEqual({ error: "notAuthenticated" });
  });

  it("空名称返回 projectNameRequired", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(createProject({ ...VALID_INPUT, name: " " })).resolves.toEqual({
      error: "projectNameRequired",
    });
  });

  it("非法 slug 返回 slugInvalid", async () => {
    createClientMock.mockResolvedValue(mockClient());
    await expect(createProject({ ...VALID_INPUT, slug: "Bad Slug!" })).resolves.toEqual({
      error: "slugInvalid",
    });
  });

  it("无团队成员记录返回 noTeam", async () => {
    createClientMock.mockResolvedValue(mockClient({ membership: null }));
    await expect(createProject(VALID_INPUT)).resolves.toEqual({ error: "noTeam" });
  });

  it("非 owner/admin 返回 onlyAdminsCreateProject", async () => {
    createClientMock.mockResolvedValue(
      mockClient({ membership: { team_id: "t1", role: "member" } }),
    );
    await expect(createProject(VALID_INPUT)).resolves.toEqual({ error: "onlyAdminsCreateProject" });
  });

  it("owner 创建成功并触发 revalidatePath", async () => {
    createClientMock.mockResolvedValue(mockClient());
    const result = await createProject(VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project).toMatchObject({ name: "My Project", slug: "my-project" });
    }
    expect(revalidatePathMock).toHaveBeenCalledWith(ROUTES.dashboardProjects);
  });

  it("slug 冲突返回 projectSlugExists", async () => {
    createClientMock.mockResolvedValue(
      mockClient({ insertError: { code: "23505", message: "dup" } }),
    );
    await expect(createProject(VALID_INPUT)).resolves.toEqual({ error: "projectSlugExists" });
  });

  it("其他数据库错误返回 databaseError", async () => {
    createClientMock.mockResolvedValue(mockClient({ insertError: { message: "db" } }));
    await expect(createProject(VALID_INPUT)).resolves.toEqual({ error: "databaseError" });
  });
});
