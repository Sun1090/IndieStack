/**
 * 团队管理 API 路由
 * 提供团队的创建、查询、更新和删除接口
 *
 * GET    /api/teams[?id=xxx]        — 获取团队列表或单个团队详情
 * POST   /api/teams                 — 创建新团队
 * PATCH  /api/teams?id=xxx          — 更新团队信息
 * DELETE /api/teams?id=xxx          — 删除团队（仅所有者）
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { safelyRequireAuth, safelyRequirePermission, guardHttpStatus } from "@/lib/auth/guards";
import { createTeamSchema, updateTeamSchema } from "@/lib/validations/team";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

/**
 * GET /api/teams
 * 获取当前用户所属的所有团队，或单个团队详情
 */
export async function GET(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequirePermission(PERMISSIONS.team.read);
  if (!auth.success) {
    return NextResponse.json(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("id");

  try {
    const supabase = await createClient();

    if (teamId) {
      // 获取单个团队详情
      const { data: team, error: teamError } = (await supabase
        .from("teams")
        .select("*")
        .eq("id", teamId)
        .single()) as unknown as {
        data: Database["public"]["Tables"]["teams"]["Row"] | null;
        error: { message: string; code?: string } | null;
      };

      if (teamError) {
        // RLS 下非成员或不存在时 .single() 返回 0 行（PGRST116），对外统一 404，避免区分存在性
        if (teamError.code === "PGRST116") {
          return NextResponse.json({ error: "Team not found" }, { status: 404 });
        }
        console.error("[Teams API] 获取团队详情失败:", teamError.message);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
      if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
      }

      return NextResponse.json({ team });
    }

    // 获取用户所有团队
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: memberships } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id);

    if (!memberships || memberships.length === 0) {
      return NextResponse.json({ teams: [] });
    }

    const teamIds = memberships.map((m: { team_id: string }) => m.team_id);

    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("*")
      .in("id", teamIds);

    if (teamsError) {
      console.error("[Teams API] 获取团队列表失败:", teamsError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ teams: teams ?? [] });
  } catch (error) {
    console.error("[Teams API] 获取团队失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/teams
 * 创建新团队
 */
export async function POST(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }

  const auth = await safelyRequireAuth();
  if (!auth.success) {
    return NextResponse.json({ error: auth.error.message }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validated = createTeamSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: team, error: teamError } = (await admin
      .from("teams")
      .insert({
        name: validated.data.name,
        slug: validated.data.slug,
        owner_id: auth.data.id,
        member_count: 1,
      })
      .select()
      .single()) as unknown as {
      data: Database["public"]["Tables"]["teams"]["Row"] | null;
      error: { code: string; message: string } | null;
    };

    if (teamError) {
      if (teamError.code === "23505") {
        return NextResponse.json(
          { error: "A team with this slug already exists" },
          { status: 409 },
        );
      }
      console.error("[Teams API] 创建团队失败:", teamError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // 将创建者添加为所有者
    const { error: memberError } = await admin
      .from("team_members")
      .insert({ team_id: team!.id, user_id: auth.data.id, role: "owner" });

    if (memberError) {
      // 回滚团队创建，避免成员插入失败时产生孤儿团队
      await admin.from("teams").delete().eq("id", team!.id);
      console.error("[Teams API] 添加所有者失败，已回滚:", memberError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ team }, { status: 201 });
  } catch (error) {
    console.error("[Teams API] 创建团队失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/teams
 * 更新团队信息（名称、slug）
 */
export async function PATCH(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }
  const auth = await safelyRequirePermission(PERMISSIONS.team.write);
  if (!auth.success) {
    return NextResponse.json(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("id");
    if (!teamId) {
      return NextResponse.json({ error: "Team ID is required" }, { status: 400 });
    }

    const body = await request.json();
    const validated = updateTeamSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: validated.error.errors[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: membership } = (await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", auth.data.id)
      .maybeSingle()) as unknown as { data: { role: string } | null };

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return NextResponse.json({ error: "Only team admins can update the team" }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: team, error } = (await admin
      .from("teams")
      .update(validated.data)
      .eq("id", teamId)
      .select()
      .single()) as unknown as {
      data: Database["public"]["Tables"]["teams"]["Row"] | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error("[Teams API] 更新团队失败:", error.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ team });
  } catch (error) {
    console.error("[Teams API] 更新团队失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/teams
 * 删除团队（仅团队所有者）
 */
export async function DELETE(request: NextRequest) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json(
      { error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) },
      { status: 429 },
    );
  }
  const auth = await safelyRequirePermission(PERMISSIONS.team.delete);
  if (!auth.success) {
    return NextResponse.json(
      { error: auth.error.message },
      { status: guardHttpStatus(auth.error) },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const teamId = searchParams.get("id");
    if (!teamId) {
      return NextResponse.json({ error: "Team ID is required" }, { status: 400 });
    }

    const supabase = await createClient();

    // 验证当前用户是团队所有者
    const { data: membership } = (await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", teamId)
      .eq("user_id", auth.data.id)
      .single()) as unknown as { data: { role: string } | null };

    if (!membership || membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only the team owner can delete the team" },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    // 删除团队（team_members / projects / subscriptions 等均通过外键 ON DELETE CASCADE 级联清理）
    // 注意：不要先手动删除 team_members —— 若 teams 删除失败会导致团队成为"僵尸团队"，
    // 且 owner 成员已被删除后无法再通过所有权校验重试。
    const { error: deleteError } = await admin.from("teams").delete().eq("id", teamId);

    if (deleteError) {
      console.error("[Teams API] 删除团队失败:", deleteError.message);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Teams API] 删除团队失败:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
