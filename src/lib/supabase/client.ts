/**
 * Supabase 浏览器客户端
 * 用于 Client Components 中的数据获取和认证操作
 * 由 @supabase/ssr 的 createBrowserClient 自动处理会话 Cookie
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
import { shouldUseMock, createMockSupabaseClient } from "@/lib/mock";

/**
 * Supabase browser client.
 * Use in client components via:
 *   import { createClient } from "@/lib/supabase/client"
 *   const supabase = createClient()
 */

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

export function createClient() {
  // Mock 模式：返回 Mock Supabase 客户端，无需真实后端
  if (shouldUseMock()) {
    return createMockSupabaseClient() as any;
  }

  const env = getEnv();
  if (!env) {
    throw new Error(
      "Supabase client: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your Supabase project credentials.",
    );
  }
  return createBrowserClient<Database>(env.url, env.key);
}

/**
 * Check if Supabase environment variables are configured.
 * Use this to conditionally render Supabase-dependent UI.
 */
export function isSupabaseConfigured(): boolean {
  return getEnv() !== null;
}
