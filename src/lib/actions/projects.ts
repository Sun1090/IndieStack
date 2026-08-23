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
