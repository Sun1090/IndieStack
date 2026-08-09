/**
 * Supabase 管理端客户端
 * 使用 service_role key 创建，可绕过行级安全策略（RLS）
 * 仅用于需要管理员权限的服务端操作（如 Webhook 处理、后台管理任务）
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * 创建 Supabase 管理客户端
 * 使用 service_role key 发起服务端请求，绕过 RLS 策略
 * 警告：仅在受信任的服务端上下文中使用（API 路由、Server Actions）
 * 切勿在客户端代码中暴露此客户端
 *
 * @example
 *   import { createAdminClient } from "@/lib/supabase/admin"
 *   const supabaseAdmin = createAdminClient()
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "缺少环境变量: NEXT_PUBLIC_SUPABASE_URL，请检查 .env.local 配置"
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "缺少环境变量: SUPABASE_SERVICE_ROLE_KEY，请检查 .env.local 配置"
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
