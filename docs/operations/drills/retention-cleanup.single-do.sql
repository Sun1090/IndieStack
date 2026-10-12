-- 把 docs/operations/drills/retention-cleanup.sql 机械压成**一条**语句：
-- 用来证伪「多语句演练 ⇒ 必须 psql + DB 密码」。正本 14 条断言 + 6 条 cleanup 调用逐字保留。
-- 正本的 begin;/rollback; 与末尾 select 报告都被吸收进这一条语句：
--   · 临时表与函数定义走 execute $fn$…$fn$（内层函数体仍是正本原样的 $$…$$）
--   · 正本夹在两个 do 块之间的 6 条**顶层** select public.cleanup_*() 改成 perform
--   · 报告借 raise exception 的消息通道回传（实测 raise notice **不会**回传）
--
-- 跑法（本文件存在的全部理由：让「实测跑通」这句结论可重跑）：
--   pnpm exec supabase db query --local --file docs/operations/drills/retention-cleanup.single-do.sql
--   ⇒ error: DRILL-RESULT failures=0 report=ALL-14-ASSERTIONS-PASSED
-- 注意它**永远以 error 结束**——那是报告通道本身（见上）。判据是 failures=0，不是退出码。
-- 变异核对（证明 14 条断言不是恒真）：把任意一条 drill_assert 的期望值改错，
--   ⇒ failures=1 并点名那一条。已实测。
-- 本文件是**派生产物**，正本仍是 docs/operations/drills/retention-cleanup.sql；
--   改断言请改正本，再重新压缩这里，否则两份会各自漂移。
-- 仍未验证：把 --local 换成 --linked 能不能吃下这一条语句（要 SUPABASE_ACCESS_TOKEN）。
DO $drill$
declare
  n_fail int;
  v_report text;

  u uuid;
  t text;
begin
  execute $fn$ create temp table drill_fail (msg text) $fn$;
  execute $fn$ create or replace function drill_assert(label text, want int, got int) returns void language plpgsql as $$ begin if want is distinct from got then insert into drill_fail values (format('%s：期望 %s，实际 %s', label, want, got)); end if; end;$$ $fn$;

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
  select 'drill', 'drill@example.invalid', v.label, 'drill body', v.status,
         now() - make_interval(days => v.days)
  from (values
    ('drill-c-resolved-expired', 'resolved', 366),
    ('drill-c-resolved-inside', 'resolved', 364),
    ('drill-c-new-expired', 'new', 999)
  ) as v(label, status, days);
  perform public.cleanup_old_notifications();
  perform public.cleanup_old_webhook_events();
  perform public.cleanup_old_email_worker_runs();
  perform public.cleanup_old_api_usage();
  perform public.prune_deleted_upload_objects();
  perform public.cleanup_resolved_contact_messages();

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
  select count(*) into n_fail from drill_fail;
  select coalesce(string_agg(msg, ' | '), 'ALL-14-ASSERTIONS-PASSED') into v_report from drill_fail;
  raise exception 'DRILL-RESULT failures=% report=%', n_fail, v_report;
end
$drill$;
