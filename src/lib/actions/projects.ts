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
import { cleanupManagedStorageUrl } from "@/lib/storage";
import { logActionError } from "@/lib/api-log";

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

  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  // 读失败与「这个用户没有团队」不是一回事：后者要引导去建团队，前者只要用户重试一次。
  // 落进 `!membership` 就会把一次抖动答成「你还没有团队」。
  if (membershipError) {
    await logActionError("[createProject] 团队成员身份读取失败", membershipError);
    return fail("databaseError");
  }

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
    await logActionError("[createProject] 创建项目失败", error);
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
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("team_id, logo_url")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    await logActionError("[deleteProject] 项目读取失败", projectError);
    return fail("databaseError");
  }

  if (!project) return fail("projectNotFound");

  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", project.team_id)
    .eq("user_id", user.id)
    .maybeSingle();

  // 同上：读失败时答「只有团队管理员能操作」，用户会以为自己权限被改了，
  // 而真正该做的事是重试一次。
  if (membershipError) {
    await logActionError("[deleteProject] 团队成员身份读取失败", membershipError);
    return fail("databaseError");
  }

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return fail("onlyAdminsCreateProject");
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId);

  if (error) {
    await logActionError("[deleteProject] 删除项目失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProjects);
  await cleanupManagedStorageUrl(project.logo_url, "covers", projectId, {
    operation: "project-delete",
    resourceId: projectId,
  });
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("team_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError) {
    await logActionError("[updateProject] 项目读取失败", projectError);
    return fail("databaseError");
  }

  if (!project) return fail("projectNotFound");

  const { data: membership, error: membershipError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", project.team_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    await logActionError("[updateProject] 团队成员身份读取失败", membershipError);
    return fail("databaseError");
  }

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
    // 合并写入 config（保留未提交的其他键）。这一处是台账里最贵的：读失败时
    // `current?.config ?? {}` 会安静地当成「原本没有键」，于是这次 update 把项目 config 里
    // 没提交的其他键全部抹掉——用户只是改了个开关，却丢了别处的配置，而且没有任何地方报错。
    // 合并的前提是知道原来有什么，读不到就必须停下来，不能拿空对象继续算。
    const { data: current, error: currentError } = await supabase
      .from("projects")
      .select("config")
      .eq("id", projectId)
      .maybeSingle();

    if (currentError) {
      await logActionError("[updateProject] 项目 config 读取失败", currentError);
      return fail("databaseError");
    }

    patch.config = { ...(current?.config ?? {}), ...input.config };
  }

  const { error } = await supabase.from("projects").update(patch).eq("id", projectId);

  if (error) {
    await logActionError("[updateProject] 更新项目失败", error);
    return fail("databaseError");
  }

  revalidatePath(ROUTES.dashboardProjects);
  return ok();
}
