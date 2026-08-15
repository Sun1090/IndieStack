/**
 * 用户信息 API 路由
 * 提供当前登录用户的信息查询接口
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import type { Database } from "@/lib/supabase/database.types";
import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";

/** PATCH 请求体校验：白名单字段 + 类型/长度限制，拒绝未知字段 */
const profilePatchSchema = z
  .object({
    full_name: z.string().trim().min(1, "fullNameRequired").max(100).optional(),
    avatar_url: z.string().url("invalidInput").nullable().optional(),
    bio: z.string().max(500).nullable().optional(),
    timezone: z.string().max(100).nullable().optional(),
    language: z.string().max(50).nullable().optional(),
  })
  .strict();

/**
 * GET /api/user - Get the current user's profile
 */
export async function GET(request: Request) {
  const limits = await rateLimit.check(request);
  if (!limits.allowed) {
    return NextResponse.json({ error: "Too Many Requests", retryAfter: Math.ceil(limits.resetIn / 1000) }, { status: 429 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single() as unknown as { data: Database["public"]["Tables"]["profiles"]["Row"] | null; error: { message: string } | null };

  if (profileError) {
    console.error("[API /user] 获取用户资料失败:", profileError.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.email_confirmed_at != null,
      createdAt: user.created_at,
    },
    profile,
  });
}

/**
 * PATCH /api/user - Update the current user's profile
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();

  // 白名单校验：仅允许预定义字段，避免任意字段/类型写入 profiles
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { full_name, avatar_url, bio, timezone, language } = parsed.data;

  const updateData: Database["public"]["Tables"]["profiles"]["Update"] = {};
  if (full_name !== undefined) updateData.full_name = full_name;
  if (avatar_url !== undefined) updateData.avatar_url = avatar_url;
  if (bio !== undefined) updateData.bio = bio;
  if (timezone !== undefined) updateData.timezone = timezone;
  if (language !== undefined) updateData.language = language;
  updateData.updated_at = new Date().toISOString();

  const { data: profile, error } = await supabase
    .from("profiles")
    .update(updateData as unknown as never)
    .eq("id", user.id)
    .select()
    .single() as unknown as { data: Database["public"]["Tables"]["profiles"]["Row"] | null; error: { message: string } | null };

  if (error) {
    console.error("[API /user] 更新用户资料失败:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ profile });
}

/**
 * DELETE /api/user - Delete the current user's account
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Delete user via admin API
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);

  if (error) {
    console.error("[API /user] 删除用户失败:", error.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
