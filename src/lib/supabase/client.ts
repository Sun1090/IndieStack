/**
 * Supabase 浏览器客户端
 * 用于 Client Components 中的数据获取和认证操作
 * 由 @supabase/ssr 的 createBrowserClient 自动处理会话 Cookie
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";
// 两行 import 分开写，顺序不能换：
//   · `shouldUseMock` 从**零依赖**的 config 模块取（它文件头就写着「仅供 bundle 体积敏感
//     的场景引入，避免把 faker 打进 Edge 运行时」）；
//   · mock 工厂只能静态引这一个，但它引的那一整块（`./data` 的 faker + `./store`）很重，
//     所以下面那个分支**必须能被构建期折掉**——见 `createClient()` 里的说明。
import { shouldUseMock } from "@/lib/mock/config";
import { createMockSupabaseClient } from "@/lib/mock";

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
  // Mock 模式：返回 Mock Supabase 客户端，无需真实后端。
  //
  // **这个三元不能简化成 `if (shouldUseMock())`**，代价是实测出来的（2026-09-29）：
  // 生产首页的 HTML 直接 `<script src>` 了一个 742 kB 的 chunk（gzip 246 kB），
  // 内容是 mock 种子数据 + 整包 faker，**占首页 JS 总量（506 kB）的 48%**。
  // 成因链：静态 import 把 mock 桶拖进客户端图 → 桶静态引 `./data`（faker）与 `./store` →
  // 本仓库 12 个 `"use client"` 模块都碰 `createClient` → 整块跟着每一个客户端入口走。
  //
  // 为什么 `config.ts` 的折叠救不了这里：它折的是 `isMockEnabled` 这个**常量**，
  // 而这里写的是 `shouldUseMock()` —— **一次函数调用把常量链断掉了**，
  // 于是分支活着、静态 import 活着、整块 faker 跟着活着。
  // 把 `NODE_ENV === "production"` 写进这个三元，打包器就能把分支折成常量 `false`，
  // `createMockSupabaseClient` 随之没有引用点，整块被摇掉。
  // 与 `mock/config.ts` 里 `isMockEnabled` 的折叠是同一个机制，形状由
  // `src/lib/release/mock-client-bundle.test.ts` 钉住（它还会拦下别的客户端模块静态引 mock 桶）。
  if (process.env.NODE_ENV === "production" ? false : shouldUseMock()) {
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
