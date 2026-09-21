/**
 * 账户数据擦除（service_role）
 *
 * `public.erase_user_data(uuid)`（迁移 032）是删除账户前唯一能把外键级联覆盖不到的
 * 个人数据清干净入口：`api_usage`（含 `ip_address`）与 `audit_logs` 的 `user_id` 是
 * `on delete set null`，删号只会留下失去指向、但仍带 PII 的行；`contact_messages`
 * 按裸邮箱存储，根本没有外键。
 *
 * 访问边界：该 RPC 是 `security definer` + 空 `search_path`，迁移 032 把 `EXECUTE`
 * 从 PUBLIC / anon / authenticated 收回（沿用 028 的结论：客户端可直接 `rpc()`
 * 触发擦除属于数据破坏面），只有 service_role 可调用，因此这里必须用 admin 客户端。
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCOUNT_ERASURE_ARG,
  ACCOUNT_ERASURE_RPC,
  parseAccountErasureCounts,
  type AccountErasureCounts,
} from "@/lib/privacy/data-policy";

/**
 * 擦除一个账户的个人数据，返回各数据面受影响的行数。
 *
 * 失败即抛错：调用方（`@/lib/account/deletion`）据此中止删号，
 * 避免「号删了、数据没擦」这种无法事后补救的状态。
 */
export async function eraseAccountData(userId: string): Promise<AccountErasureCounts> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(ACCOUNT_ERASURE_RPC, {
    [ACCOUNT_ERASURE_ARG]: userId,
  });
  if (error) throw new Error(error.message);
  return parseAccountErasureCounts(data);
}
