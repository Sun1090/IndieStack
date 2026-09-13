-- =============================================================================
-- 027: 邮件 worker 运行记录保留期（H08 数据保留续）
-- 每次 /api/cron/digest 执行都会向 email_worker_runs 落一行（拉取/发送/失败计数
-- 与耗时，供 admin 看板与积压排查）。该表此前没有任何保留期，长期运行会无界增长。
-- 本迁移新增 cleanup_old_email_worker_runs()：保留 90 天，与 notifications（已读）
-- 和 webhook_events 的保留期对齐，并通过 pg_cron 每周执行。
-- pg_cron 未安装时跳过（本地/最小化环境安全），生产需在 Supabase Dashboard 确认
-- pg_cron 扩展已启用；策略见 docs/db/retention.md。
-- =============================================================================

create or replace function public.cleanup_old_email_worker_runs()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.email_worker_runs
  where created_at < now() - interval '90 days';
end;
$$;

-- 与既有清理任务错开 15 分钟，避免同一时刻在同一个库上叠加删除负载
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cleanup-old-email-worker-runs',
      '15 4 * * 0',
      $$select public.cleanup_old_email_worker_runs()$$
    );
  end if;
end
$do$;
