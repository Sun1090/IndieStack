/**
 * Supabase 服务端客户端
 * 用于 Server Components、Route Handlers 和 Server Actions 中的数据获取
 * 使用 Cookie 进行会话管理，由 @supabase/ssr 自动处理
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { shouldUseMock, createMockSupabaseClient } from "@/lib/mock";

/**
 * Supabase server client.
 * Use in Server Components, Route Handlers, and Server Actions:
 *   import { createClient } from "@/lib/supabase/server"
 *   const supabase = await createClient()
 */

function getServerEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

export async function createClient() {
  // Mock 模式：返回 Mock Supabase 客户端，无需真实后端
  if (shouldUseMock()) {
    return createMockSupabaseClient() as any;
  }

  const env = getServerEnv();
  if (!env) {
    throw new Error(
      "Supabase server client: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project credentials.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(
            ({
              name,
              value,
              options,
            }: {
              name: string;
              value: string;
              options?: Record<string, unknown>;
            }) => cookieStore.set(name, value, options),
          );
        } catch {
          // Called from Server Component — ignore
        }
      },
    },
  });
}

/**
 * Check if Supabase environment variables are configured.
 */
export function isSupabaseConfigured(): boolean {
  return getServerEnv() !== null;
}
