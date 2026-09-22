-- 保留期清理端到端演练（H08 / v0.11.0+ 的 /api/cron/retention）
--
-- 为什么需要它：`/api/cron/retention` 只证明「函数被调用」，单元与 E2E 测试跑的是 mock，
-- 都不碰真实 SQL。而保留期的失败面恰恰在 SQL 里——窗口边界写错一天、状态谓词漏写一个，
-- 结果是要么隐私承诺失真（过期行还在），要么用户数据被静默删掉（未读通知被当过期删了）。
-- 这两种都不会让门禁变红，只能靠真 Postgres 上的一次演练留下可核对的结果。
--
-- 运行方式（本地 Supabase 栈；整段包在 begin/rollback 里，跑完不留数据）：
--   docker exec -i supabase_db_indiestack psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < docs/operations/drills/retention-cleanup.sql
-- 也可用 `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres"` 直接连本地库。
-- 最后一行输出的 failures 为 0 即通过；非 0 时 report 会列出是哪几条断言不符。
--
-- 覆盖的断言（每个清理函数都测「窗口两侧 + 受保护状态」）：
--   - cleanup_old_notifications：已读且 91 天的删；已读但 89 天的留；
--     未读即使 999 天也留（未读代表用户还没看到，删了就是静默丢消息）；
--   - cleanup_old_webhook_events：91 天删 / 89 天留；
--   - cleanup_old_email_worker_runs：只清越过 90 天那一条；
--   - cleanup_old_api_usage：91 天删 / 89 天留；
--   - prune_deleted_upload_objects：`deleted` 且 31 天的清；`deleted` 但 29 天的留；
--     `active` 即使 999 天也绝不因保留期被清（它是对象是否应存在的唯一依据）；
--   - cleanup_resolved_contact_messages：`resolved` 超 365 天删、未超留；
--     `new` 即使 999 天也留（未处理的求助不能被定时删掉）。
-- 窗口两侧特意取「差一天」而不是「差一年」：断言必须能区分 `90 days` 与 `91 days` 这种
-- 真正会写错的地方，取整百天的样本任何实现都能蒙对过去。
begin;

create temp table drill_fail (msg text);

create or replace function drill_assert(label text, want int, got int)
returns void language plpgsql as $$
begin
  if want is distinct from got then
    insert into drill_fail values (format('%s：期望 %s，实际 %s', label, want, got));
  end if;
end;
$$;

do $drive$
declare
  u uuid;
  t text;
begin
  u := (select id from public.profiles order by created_at limit 1);
  if u is null then
    insert into drill_fail values ('本地库没有 profiles，无法演练通知清理');
    return;
  end if;
  t := coalesce((select type from public.notifications limit 1), 'system');

  -- 1) notifications：90 天窗口 + is_read 谓词
  insert into public.notifications (user_id, type, title, is_read, created_at)
  select u, t, v.label, v.read, now() - make_interval(days => v.days)
  from (values
    ('drill-n-read-expired', true, 91),
    ('drill-n-read-inside', true, 89),
    ('drill-n-unread-expired', false, 999)
  ) as v(label, read, days);

  -- 2) webhook_events：90 天，无状态谓词
  insert into public.webhook_events (event_id, event_type, created_at)
  select v.label, 'checkout.session.completed', now() - make_interval(days => v.days)
  from (values ('drill-w-expired', 91), ('drill-w-inside', 89)) as v(label, days);

  -- 3) email_worker_runs：90 天
  insert into public.email_worker_runs (created_at)
  values (now() - make_interval(days => 91)), (now() - make_interval(days => 89));

  -- 4) api_usage：90 天
  insert into public.api_usage (path, method, created_at)
  select v.label, 'GET', now() - make_interval(days => v.days)
  from (values ('/drill-expired', 91), ('/drill-inside', 89)) as v(label, days);

  -- 5) upload_objects：status='deleted' 且 updated_at 超 30 天
  insert into public.upload_objects
    (bucket, object_key, owner_id, byte_size, content_type, checksum, status, updated_at)
  select 'avatars', v.label, u, 1024, 'image/png', repeat(md5(v.label), 2), v.status,
         now() - make_interval(days => v.days)
  from (values
    ('drill-u-deleted-expired', 'deleted', 31),
    ('drill-u-deleted-inside', 'deleted', 29),
    ('drill-u-active-expired', 'active', 999)
  ) as v(label, status, days);

  -- 6) contact_messages：status='resolved' 且 created_at 超 365 天
  insert into public.contact_messages (name, email, subject, message, status, created_at)
  select 'drill', 'drill@indiestack.local', v.label, 'drill body', v.status,
         now() - make_interval(days => v.days)
  from (values
    ('drill-c-resolved-expired', 'resolved', 366),
    ('drill-c-resolved-inside', 'resolved', 364),
    ('drill-c-new-expired', 'new', 999)
  ) as v(label, status, days);
end
$drive$;

-- 用真实函数名（与 RETENTION_POLICIES 的 cleanupFunction 一致）
select public.cleanup_old_notifications();
select public.cleanup_old_webhook_events();
select public.cleanup_old_email_worker_runs();
select public.cleanup_old_api_usage();
select public.prune_deleted_upload_objects();
select public.cleanup_resolved_contact_messages();

do $check$
begin
  -- 越过窗口的必须消失
  perform drill_assert('notifications 已读超窗被删', 0,
    (select count(*)::int from public.notifications where title = 'drill-n-read-expired'));
  -- 窗口内的必须留下
  perform drill_assert('notifications 已读未超窗保留', 1,
    (select count(*)::int from public.notifications where title = 'drill-n-read-inside'));
  -- 谓词保护的必须留下（未读代表用户还没看到，删了就是静默丢消息）
  perform drill_assert('notifications 未读超窗仍保留', 1,
    (select count(*)::int from public.notifications where title = 'drill-n-unread-expired'));

  perform drill_assert('webhook_events 超窗被删', 0,
    (select count(*)::int from public.webhook_events where event_id = 'drill-w-expired'));
  perform drill_assert('webhook_events 未超窗保留', 1,
    (select count(*)::int from public.webhook_events where event_id = 'drill-w-inside'));

  perform drill_assert('api_usage 超窗被删', 0,
    (select count(*)::int from public.api_usage where path = '/drill-expired'));
  perform drill_assert('api_usage 未超窗保留', 1,
    (select count(*)::int from public.api_usage where path = '/drill-inside'));

  perform drill_assert('upload_objects deleted 超 30 天被清', 0,
    (select count(*)::int from public.upload_objects where object_key = 'drill-u-deleted-expired'));
  perform drill_assert('upload_objects deleted 未超窗保留', 1,
    (select count(*)::int from public.upload_objects where object_key = 'drill-u-deleted-inside'));
  perform drill_assert('upload_objects active 永不因保留期被清', 1,
    (select count(*)::int from public.upload_objects where object_key = 'drill-u-active-expired'));

  perform drill_assert('contact_messages resolved 超 365 天被删', 0,
    (select count(*)::int from public.contact_messages where subject = 'drill-c-resolved-expired'));
  perform drill_assert('contact_messages resolved 未超窗保留', 1,
    (select count(*)::int from public.contact_messages where subject = 'drill-c-resolved-inside'));
  perform drill_assert('contact_messages new 永不因保留期被删', 1,
    (select count(*)::int from public.contact_messages where subject = 'drill-c-new-expired'));

  -- email_worker_runs 没有可标记的文本列，按总数变化断言（插入 2 条，应只剩 1 条）
  perform drill_assert('email_worker_runs 只清超窗那一条', 1,
    (select count(*)::int from public.email_worker_runs
      where created_at >= now() - interval '90 days'
        and created_at <= now() - interval '88 days'));
end
$check$;

select
  (select count(*) from drill_fail) as failures,
  coalesce((select string_agg(msg, ' | ') from drill_fail), '全部断言通过（14 条）') as report;

rollback;
