/**
 * 从环境变量或项目 URL 解析 Supabase project ref。
 *
 * 本体原先在 `src/lib/ops/supabase-restore.ts`。搬到这里的理由和 `stripComments`
 * 一样：第二个调用方出现了（`scripts/lib/migration-status-check.js` 要用它），
 * 而那个调用方**不能**导入 `supabase-restore.ts`——门禁脚本被 node 以
 * `--experimental-strip-types` 直跑，那条链路里的 `@/lib/cron-auth` 别名解析不了。
 * 与其在脚本里再写一份正则（两份会长歪），不如把纯函数放在谁都能直连的位置。
 */

/**
 * 显式变量优先，其次从 Supabase URL 推断。
 *
 * 只接受 `<ref>.supabase.co` / `<ref>.supabase.in` 形态，避免把自建代理地址当成 ref。
 */
export function resolveProjectRef(
  explicit: string | undefined | null,
  supabaseUrl: string | undefined | null,
): string | null {
  const trimmedExplicit = explicit?.trim();
  if (trimmedExplicit) return trimmedExplicit;
  const trimmedUrl = supabaseUrl?.trim();
  if (!trimmedUrl) return null;
  try {
    const host = new URL(trimmedUrl).hostname;
    const match = /^([a-z0-9]{10,32})\.supabase\.(co|in)$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
