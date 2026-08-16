/**
 * Supabase 中间件会话管理
 * 在 Edge Middleware 中刷新用户会话，同步 Cookie 状态
 * 每次请求都会检查并更新会话，确保服务端和客户端状态一致
 */
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "./database.types";
import { shouldUseMock } from "@/lib/mock";
import { generateMockSession } from "@/lib/mock/data";

/**
 * 在 Next.js Middleware 中创建 Supabase 客户端并更新会话
 * 返回 { supabase, supabaseResponse, user }
 * - supabase: 服务端 Supabase 客户端实例（Mock 模式下为 null）
 * - supabaseResponse: 带有更新 Cookie 的 NextResponse
 * - user: 当前用户信息（未登录为 null，Mock 模式下返回模拟用户）
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Mock 模式：跳过 Supabase 会话检查，返回模拟用户
  if (shouldUseMock()) {
    const session = generateMockSession();
    return {
      supabase: null as any,
      supabaseResponse,
      user: session.user,
    };
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }: { name: string; value: string }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }: {
              name: string;
              value: string;
              options?: Record<string, unknown>;
            }) => supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 刷新用户会话 —— 对 Server Components 至关重要
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, supabaseResponse, user };
}
