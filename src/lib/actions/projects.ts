/**
 * 项目管理服务端操作
 * 创建项目并校验当前用户对所属团队拥有写入权限
 */
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import type { ActionResult } from "@/lib/types/action-result";
import { fail, ok } from "@/lib/types/action-result";
import type { Database } from "@/lib/supabase/database.types";

const createProjectSchema = z.object({
  name: z.string().trim().min(1, "projectNameRequired").max(100),
  slug: z
    .string()
    .trim()
    .min(2, "slugMinLength")
    .max(50)
    .regex(/^[a-z0-9-]+$/, "slugInvalid"),
  description: z.string().trim().max(500).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export async function createProject(
  input: CreateProjectInput,
): Promise<ActionResult<{ project: Database["public"]["Tables"]["projects"]["Row"] }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("notAuthenticated");
  }

  const validated = createProjectSchema.safeParse(input);
  if (!validated.success) {
    return fail(validated.error.issues[0]?.message ?? "invalidInput");
  }

  const { data: membership } = (await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle()) as unknown as { data: { team_id: string; role: string } | null; error: null };

  if (!membership) {
    return fail("noTeam");
  }

  if (!["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsCreateProject");
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      team_id: membership.team_id,
      name: validated.data.name,
      slug: validated.data.slug,
      description: validated.data.description ?? "",
      status: "active",
      visibility: "private",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return fail("projectSlugExists");
    }
    console.error("[createProject] 创建项目失败:", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProjects);
  return ok({ project });
}

/**
 * 删除项目（仅 owner/admin）。
 * 数据库无 ON DELETE 级联到 api_usage 的外键时相关记录保留，属预期。
 */
export async function deleteProject(projectId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  // 权限校验：当前用户须为项目所属团队的 owner/admin
  const { data: project } = (await supabase
    .from("projects")
    .select("team_id")
    .eq("id", projectId)
    .maybeSingle()) as unknown as { data: { team_id: string } | null };

  if (!project) return fail("projectNotFound");

  const { data: membership } = (await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", project.team_id)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { role: string } | null; error: null };

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsCreateProject");
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId);

  if (error) {
    console.error("[deleteProject] 删除项目失败:", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProjects);
  return ok();
}

/**
 * 更新项目名称与描述（仅 owner/admin）。
 */
export async function updateProject(
  projectId: string,
  input: {
    name?: string;
    description?: string;
    config?: Record<string, unknown>;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return fail("notAuthenticated");

  const { data: project } = (await supabase
    .from("projects")
    .select("team_id")
    .eq("id", projectId)
    .maybeSingle()) as unknown as { data: { team_id: string } | null };

  if (!project) return fail("projectNotFound");

  const { data: membership } = (await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", project.team_id)
    .eq("user_id", user.id)
    .maybeSingle()) as unknown as { data: { role: string } | null; error: null };

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsCreateProject");
  }

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return fail("projectNameRequired");
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description;
  if (input.config !== undefined) {
    // 合并写入 config（保留未提交的其他键）
    const { data: current } = (await supabase
      .from("projects")
      .select("config")
      .eq("id", projectId)
      .maybeSingle()) as unknown as { data: { config: Record<string, unknown> } | null };
    patch.config = { ...(current?.config ?? {}), ...input.config };
  }

  const { error } = await supabase.from("projects").update(patch).eq("id", projectId);

  if (error) {
    console.error("[updateProject] 更新项目失败:", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProjects);
  return ok();
}
