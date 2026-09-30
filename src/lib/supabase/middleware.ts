/**
 * Supabase 中间件会话管理
 * 在 Edge Middleware 中刷新用户会话，同步 Cookie 状态
 * 每次请求都会检查并更新会话，确保服务端和客户端状态一致
 */
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "./database.types";
import { shouldUseMock } from "@/lib/mock/config";
import { NONCE_HEADER } from "@/lib/csp";

/**
 * 在 Next.js Middleware 中创建 Supabase 客户端并更新会话
 * 返回 { supabase, supabaseResponse, user }
 * - supabase: 服务端 Supabase 客户端实例（Mock 模式下为 null）
 * - supabaseResponse: 带有更新 Cookie 的 NextResponse
 * - user: 当前用户信息（未登录为 null，Mock 模式下返回模拟用户）
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // 将上游传入的 nonce 请求头透传给 Server Components（headers() 可读取）
  const nonce = request.headers.get(NONCE_HEADER) ?? undefined;
  if (nonce && !supabaseResponse.headers.get(NONCE_HEADER)) {
    supabaseResponse.headers.set(NONCE_HEADER, nonce);
  }

  // Mock 模式：跳过 Supabase 会话检查，返回模拟用户
  //
  // 动态 import 的效果**比原来注释里写的弱**，这里按实测改写（2026-09-30）：
  // 原注释说「避免把 faker 等 mock 数据依赖打进 Edge bundle」。**它做到了「不进主 bundle」，
  // 但没做到「不进产物」**：条件分支里的 `await import(...)` 仍然会被打包器**发射成一个独立
  // chunk**，落在 `.next/static/chunks/`（实测约 707 kB 的纯 faker：person/company/lorem/
  // internet/phone/finance/commerce/music/airline/word/name 等模块），并且出现在约 38 个页面的
  // `page_client-reference-manifest.js` 里——也就是**它在客户端模块图内**。
  //
  // **但它不会被任何人下载**：`await import` 只在分支真的执行时才取那个 chunk，
  // 而生产里 `shouldUseMock()` 恒为 false（见 `mock/config.ts` 的 `NODE_ENV` 折叠），
  // 于是这条分支永远不跑。Playwright 复核过 8 个生产页面，**0 次请求命中它**。
  //
  // **为什么不能像 `supabase/client.ts` 那样折掉**（那条是真的折掉了，见该文件）：
  // 那边能被摇掉是因为它用的是**静态** import——折叠后 `createMockSupabaseClient` 没有引用点，
  // 整块随之消失；而**动态 import 本身就是一次引用点**，写在死分支里也会照常发射 chunk。
  // 也就是说这里的 `import()` 恰恰是「折不掉」的原因，不是「折得掉」的手段。
  //
  // 要彻底不发射它，只能让 mock 会话不依赖 faker（例如用一份写死的 mock session），
  // 那是**改 mock 系统的行为**（种子身份要与种子数据保持一致），不在本次范围内。
  // 当前判断：用户侧影响为 0（永不被下载），代价只是部署体积，故保留并把注释改准确。
  if (shouldUseMock()) {
    const { generateMockSession } = await import("@/lib/mock/data");
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
