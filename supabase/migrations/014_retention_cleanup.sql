-- =============================================================================
-- 014: 数据保留定时清理
-- cleanup_old_notifications()（003）与本迁移新增的 cleanup_old_webhook_events()
-- 通过 pg_cron 每周执行。pg_cron 未安装时跳过（本地/最小化环境安全）。
-- 生产需在 Supabase Dashboard 确认 pg_cron 扩展已启用。
-- =============================================================================

create or replace function public.cleanup_old_webhook_events()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.webhook_events
  where created_at < now() - interval '90 days';
end;
$$;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cleanup-old-notifications',
      '0 4 * * 0',
      $$select public.cleanup_old_notifications()$$
    );
    perform cron.schedule(
      'cleanup-old-webhook-events',
      '0 4 * * 0',
      $$select public.cleanup_old_webhook_events()$$
    );
  end if;
end
$do$;
