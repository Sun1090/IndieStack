-- =============================================================================
-- 032 的保留期窗口：90 / 30 / 365 天的边界到底怎么切
--
-- 为什么补这一份：这三条保留期是**对用户与合规的承诺**
-- （`docs/db/retention.md`、`messages/*/privacy.json`），而它们此前的验证方式是
-- 「读迁移文本、和 `src/lib/privacy/erasure-policy.ts` 的常量比字符串」——
-- 比的是**数字写没写对**，不是**边界切在哪**。日期边界恰恰是差一天最常发生的地方，
-- 而差一天这件事在文本比对里完全看不见。
--
-- 每条都成对：窗口外一天必须删、窗口内一天必须留。只测「删了」等于没测——
-- 一个把整个表删掉的实现也能让「删了」变绿。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f0001', 'retention@probe.local');

/* ---------- api_usage：90 天 -------------------------------------------- */
insert into public.api_usage (user_id, path, method, ip_address, created_at) values
  ('00000000-0000-4000-8000-0000000f0001', '/kept', 'GET', '203.0.113.1', now() - interval '89 days'),
  ('00000000-0000-4000-8000-0000000f0001', '/gone', 'GET', '203.0.113.2', now() - interval '91 days'),
  ('00000000-0000-4000-8000-0000000f0001', '/gone', 'GET', '203.0.113.3', now() - interval '200 days');

/* ---------- upload_objects：deleted 满 30 天 ---------------------------- */
-- 注意这一条**只看 status='deleted' + updated_at**：active 的对象再老也不能删，
-- 那是用户正在用的头像。
insert into public.upload_objects (bucket, object_key, owner_id, byte_size, content_type, checksum, status, updated_at) values
  ('avatars', 'avatars/u/fresh.png', '00000000-0000-4000-8000-0000000f0001', 10, 'image/png', repeat('a', 64), 'deleted', now() - interval '29 days'),
  ('avatars', 'avatars/u/stale.png', '00000000-0000-4000-8000-0000000f0001', 10, 'image/png', repeat('b', 64), 'deleted', now() - interval '31 days'),
  ('avatars', 'avatars/u/old-active.png', '00000000-0000-4000-8000-0000000f0001', 10, 'image/png', repeat('c', 64), 'active', now() - interval '400 days');

/* ---------- contact_messages：resolved 满 365 天 ------------------------ */
-- `new` / `in_progress` 的求助**永不按时间清理**：删掉未处理的用户求助就是静默丢单。
insert into public.contact_messages (name, email, subject, message, status, created_at) values
  ('R', 'r@probe.local', 'kept', 'still within a year', 'resolved', now() - interval '364 days'),
  ('R', 'r@probe.local', 'gone', 'past a year', 'resolved', now() - interval '366 days'),
  ('R', 'r@probe.local', 'new', 'never auto-deleted', 'new', now() - interval '400 days'),
  ('R', 'r@probe.local', 'wip', 'never auto-deleted', 'in_progress', now() - interval '400 days');

/* ---------- 跑三个清理函数（service_role 是它们的唯一调用者）------------- */
select public.cleanup_old_api_usage();
select public.prune_deleted_upload_objects();
select public.cleanup_resolved_contact_messages();

/* ---------- 读数 -------------------------------------------------------- */
select probe.expect(
  'api_usage：89 天前的留着',
  (select count(*)::int from public.api_usage
     where user_id = '00000000-0000-4000-8000-0000000f0001' and path = '/kept'),
  1
);
-- 数的是「还剩下几行超过 90 天的」，所以删干净就该是 0。
select probe.expect(
  'api_usage：超过 90 天的一行不剩',
  (select count(*)::int from public.api_usage
     where user_id = '00000000-0000-4000-8000-0000000f0001' and created_at < now() - interval '90 days'),
  0
);
select probe.expect(
  'upload_objects：deleted 29 天的留着',
  (select count(*)::int from public.upload_objects where object_key = 'avatars/u/fresh.png'),
  1
);
select probe.expect(
  'upload_objects：deleted 31 天的删掉',
  (select count(*)::int from public.upload_objects where object_key = 'avatars/u/stale.png'),
  0
);
select probe.expect(
  'upload_objects：active 400 天的**不删**（元数据不是垃圾）',
  (select count(*)::int from public.upload_objects where object_key = 'avatars/u/old-active.png'),
  1
);
select probe.expect(
  'contact_messages：resolved 364 天的留着',
  (select count(*)::int from public.contact_messages where subject = 'kept'),
  1
);
select probe.expect(
  'contact_messages：resolved 366 天的删掉',
  (select count(*)::int from public.contact_messages where subject = 'gone'),
  0
);
select probe.expect(
  'contact_messages：new 400 天的**不删**（未处理的求助不能静默丢单）',
  (select count(*)::int from public.contact_messages where subject = 'new'),
  1
);
select probe.expect(
  'contact_messages：in_progress 400 天的**不删**',
  (select count(*)::int from public.contact_messages where subject = 'wip'),
  1
);

\o
select probe.verify('032 保留期窗口：90 天 api_usage / 30 天已删对象 / 365 天已解决求助');

rollback;
