-- =============================================================================
-- 028: SECURITY DEFINER 执行权限收口（H09 安全加固续）
-- 背景：PostgreSQL 默认把新建函数的 EXECUTE 授予 PUBLIC，Supabase 的默认权限又额外
--   显式授予 anon / authenticated / service_role。结果是所有 SECURITY DEFINER 函数对
--   匿名与登录用户都可直接 `rpc()` 调用。对只应由服务端或计划任务使用的函数来说这是
--   越权面：
--     - cleanup_old_notifications() / cleanup_old_webhook_events() /
--       cleanup_old_email_worker_runs()：anon 可强制批量删除保留期内的数据（数据破坏）。
--     - log_audit_action()：anon 可伪造审计日志行（审计完整性）。
--   本迁移把这三类清理函数与审计写入函数的 EXECUTE 从 PUBLIC / anon / authenticated
--   收回，只保留 service_role（服务端）与函数属主（pg_cron 任务以属主身份执行）。
--   注意：RLS 策略内引用的辅助函数（is_team_* / get_*）必须保留 authenticated 的 EXECUTE，
--   否则策略求值会直接报 permission denied；本迁移刻意不动它们。
--   门禁：scripts/check-supabase-security.js 会对未撤权的 SECURITY DEFINER 函数失败封闭。
-- =============================================================================

revoke all on function public.cleanup_old_notifications() from public, anon, authenticated;
revoke all on function public.cleanup_old_webhook_events() from public, anon, authenticated;
revoke all on function public.cleanup_old_email_worker_runs() from public, anon, authenticated;
revoke all on function public.log_audit_action(text, text, text, jsonb)
  from public, anon, authenticated;

-- 显式回授 service_role：应用侧（Server Action / Route Handler 的 admin client）与运维脚本
-- 通过 service_role 调用；函数属主（postgres）与 pg_cron 任务天然保留权限。
grant execute on function public.cleanup_old_notifications() to service_role;
grant execute on function public.cleanup_old_webhook_events() to service_role;
grant execute on function public.cleanup_old_email_worker_runs() to service_role;
grant execute on function public.log_audit_action(text, text, text, jsonb) to service_role;
