-- 把 docs/operations/drills/account-erasure.sql 机械压成**一条**语句，
-- 让它能经 Management API 的 `POST /v1/projects/{ref}/database/query` 送出去。
-- 这是 B04 缺口 (a) 的产出物。正本仍是 account-erasure.sql，本文件是**派生产物**：
--   改断言请改正本，再重新压缩这里，否则两份会各自漂移。
--
-- 正本里有 6 条 psql 元命令（条数由 src/lib/drills/psql-meta.ts 量，不是手数）。
-- 逐条怎么处理的，都在下面：
--   · `\set ON_ERROR_STOP on`（第 24 行）——**删掉**。HTTP 通道没有这个开关，
--     出错靠响应码与错误文本判断（`ops:cloud-sql-probe` 实测：非 2xx 会带
--     `Failed to run sql query: ERROR: …`）。
--   · 4 条 `\echo '--- 标题 ---'`——**删掉**。它们只是给人看的分隔标签。
--   · `\gset drill_`（第 102 行）——**这条必须翻译，不能删**。它把 temp 表里的值
--     取进 psql 变量，供后面 **16 处** `:'drill_*'` 引用。
--     这里换成 **plpgsql 变量**（v_uid / v_uemail / …），语义等价。
--
-- ## 为什么换成 plpgsql 变量而不是继续用 temp 表（本轮实测出来的坑）
--
-- 正本在 `set role service_role` 之后调用 `erase_user_data()` 等函数——
-- **这是刻意的**：那三个函数的 EXECUTE 权限只给了 `service_role`
-- （`pg_proc.proacl` 实测：`{postgres=X/postgres, service_role=X/postgres}`），
-- 而演练要验的正是**应用真实调用路径**上的权限形状。所以角色切换**不能省**。
--
-- 但角色切换会把 temp 表挡掉。2026-10-13 本机实测（本地栈，fresh 连接）：
--   · `execute 'set role service_role'` 在 DO 块里**可用**；
--   · 切过去之后 `select … from <temp 表>` ⇒ **permission denied for table**
--     （temp 表属于建它的 postgres）——正本第 102 行那句注释
--     「取到 psql 变量：SET ROLE service_role 之后就读不到 temp 表了」说的就是这件事，
--     它用 `\gset` 把值**搬到角色之外**；
--   · plpgsql **变量**不受影响：切到 service_role 后 `… where id = v_uid` 实测可用；
--   · `reset role` 在块内可用；而且**即使块以 raise exception 结束、没来得及 reset，
--     角色也不会漏到会话里**（实测：块后 `current_user` 回到 postgres）。
-- ⇒ 所以：值走变量，temp 表只在 postgres 身份下用（`drill_fail` 就是），
--   而**所有 `drill_assert` 都在 `reset role` 之后**——否则它会撞上同一个 permission denied，
--   并且那次的表现是「断言函数自己挂了」，不是「演练失败」。
--
-- 跑法（本文件存在的全部理由：让「实测跑通」这句结论可重跑）：
--   本地：docker exec -i supabase_db_indiestack psql -U postgres -d postgres \
--           -f docs/operations/drills/account-erasure.single-do.sql
--   或：  pnpm exec supabase db query --local --file <本文件>
--   ⇒ error: DRILL-RESULT failures=0 assertions=20 report=ALL-20-ASSERTIONS-PASSED
-- 它**永远以 error 结束**——那是报告通道本身（正本靠 `rollback;` 收尾，
-- 这里靠「raise exception 让整条语句回滚」，两者对数据的净效果相同：什么都不留）。
-- **判据是 failures=0，不是退出码。**
-- 变异核对（证明 20 条断言不是恒真）：把任意一条 drill_assert 的期望值改错，
--   ⇒ failures=1 并点名那一条。
--
-- 覆盖的断言与正本逐字相同（20 条：擦除后 13 + 删号后 7），
-- 三段信息性输出（object-list / reference-detection / erasure 计数）
-- 不进断言、改放进报告文本——**刻意不顺手把它们变成断言**：
-- 那会让「转换版与正本给出同样的 20 条 actual=expected」这条可比性判据失效。
DO $drill$
declare
  n_fail int;
  v_report text;
  v_info text = '';
  v_json jsonb;

  -- 正本用 \gset 取的那四个值（16 处引用的来源）
  v_uid uuid;
  v_uemail text;
  v_avatar_key text;
  v_orphan_key text;
  v_other_owner uuid;
begin
  execute $fn$ create temp table drill_fail (msg text) $fn$;
  execute $fn$ create or replace function drill_assert(label text, want int, got int) returns void language plpgsql as $$ begin if want is distinct from got then insert into drill_fail values (format('%s：期望 %s，实际 %s', label, want, got)); end if; end;$$ $fn$;

  -- 1) 两个隔离账户：本人的邮箱故意大小写混排，验证 lower(btrim()) 匹配
  --    正本先 insert into d 再读回；这里一步 select into 变量。
  with new_user as (
    insert into auth.users (id, email) values (gen_random_uuid(), 'Drill.ErASE@Example.TEST') returning id, email
  ), other_user as (
    insert into auth.users (id, email) values (gen_random_uuid(), 'other-occupant@example.test') returning id
  )
  select new_user.id, new_user.email,
         'avatars/' || new_user.id::text || '/drill.png',
         'avatars/' || new_user.id::text || '/leftover.png',
         other_user.id
    into v_uid, v_uemail, v_avatar_key, v_orphan_key, v_other_owner
  from new_user, other_user;

  -- 2) 资料：本人头像 URL 指向自己的对象；他人资料不参与
  update public.profiles p
  set email = v_uemail, full_name = 'Drill User', role = 'member',
      avatar_url = 'https://cdn.example.test/storage/v1/object/public/avatars/' || v_avatar_key
  where p.id = v_uid;

  -- 3) api_usage：本人两条（含 IP）+ 他人一条
  insert into public.api_usage (user_id, path, method, status_code, ip_address, created_at)
  select v_uid, '/api/projects', 'GET', 200, '203.0.113.7'::inet, now()
  union all select v_uid, '/api/user', 'DELETE', 204, '203.0.113.8'::inet, now()
  union all select v_other_owner, '/api/projects', 'GET', 200, '203.0.113.9'::inet, now();

  -- 4) audit_logs：本人三行（PII object / 非本人 entity / 非 object metadata）+ 他人一行
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, created_at)
  select v_uid, 'drill.account.login', 'user', v_uid::text,
         jsonb_build_object('email', 'drill.erase@example.test', 'ip', '203.0.113.7',
                            'user_agent', 'Mozilla/5.0', 'ipAddressKept', 'x', 'keepMe', 'session-a'),
         now()
  union all
  select v_uid, 'drill.project.updated', 'project', 'project-42',
         jsonb_build_object('avatar_url', 'https://x/y.png', 'name', 'kept-field'), now()
  union all
  select v_uid, 'drill.legacy.shape', 'user', v_uid::text, '["not","an","object"]'::jsonb, now()
  union all
  select v_other_owner, 'drill.other.login', 'user', v_other_owner::text,
         jsonb_build_object('email', 'other-occupant@example.test'), now();

  -- 5) contact_messages：两种邮箱写法都属于本人，另一种属于他人（该表无外键，级联覆盖不到）
  insert into public.contact_messages (name, email, subject, message, status)
  select 'Drill', '  DRILL.eRASE@example.TEST  ', 'hi', 'padded address', 'new'
  union all select 'Drill', 'drill.erase@example.test', 'hi', 'plain address', 'resolved'
  union all select 'Other', 'other-occupant@example.test', 'hi', 'someone else', 'new';

  -- 6) upload_objects：被头像引用的一行、未被引用的一行、他人团队封面一行
  insert into public.upload_objects (bucket, object_key, owner_id, byte_size, content_type, checksum, status, created_at)
  select 'avatars', v_avatar_key, v_uid, 1234, 'image/png',
         '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now()
  union all
  select 'avatars', v_orphan_key, v_uid, 2345, 'image/png',
         '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now()
  union all
  select 'covers', 'covers/drill-team-shared.png', v_other_owner, 3456, 'image/png',
         '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now();

  -- 6b) 他人团队项目引用同一 bucket 下的封面：删本人账户绝不能弄坏别人的页面
  insert into public.projects (id, team_id, name, slug, status, visibility, logo_url, created_by, created_at, updated_at)
  select gen_random_uuid(), tm.team_id, 'Drill Team Project',
         'drill-team-' || substr(v_other_owner::text, 1, 8), 'active', 'team',
         'https://cdn.example.test/storage/v1/object/public/covers/drill-team-shared.png',
         v_other_owner, now(), now()
  from (select team_id from public.team_members where user_id = v_other_owner limit 1) tm;

  -- 7) 删号前：应用侧拿到的对象清单，referenced=false 才允许删
  --    正本在这里 `set role service_role`——**保留**，理由见文件头（权限形状是演练对象的一部分）
  execute 'set role service_role';
  select jsonb_agg(jsonb_build_object('key', right(object_key, 12), 'referenced', referenced)
                   order by object_key)
    into v_json
  from public.list_user_objects_for_erasure(v_uid);
  v_info := v_info || format(' object-list=%s', coalesce(v_json::text, 'NULL'));

  select jsonb_build_object(
           'avatarReferenced', public.upload_object_is_referenced(v_avatar_key),
           'leftoverReferenced', public.upload_object_is_referenced(v_orphan_key),
           'teamCoverReferenced', public.upload_object_is_referenced('covers/drill-team-shared.png'),
           'wildcardUnderscoreNotMatched', public.upload_object_is_referenced('xavatars/' || v_uid || '/drill.png'),
           'prefixTailNotMatched', public.upload_object_is_referenced('drill.png')
         )
    into v_json;
  v_info := v_info || format(' reference-detection=%s', v_json::text);
  execute 'reset role';

  -- 8) 模拟「未引用对象已由 provider 删除」：元数据标记 deleted
  update public.upload_objects set status = 'deleted' where object_key = v_orphan_key;

  -- 9) 先擦除（同样以 service_role 调用）
  execute 'set role service_role';
  select public.erase_user_data(v_uid) into v_json;
  v_info := v_info || format(' erasure=%s', coalesce(v_json::text, 'NULL'));
  execute 'reset role';

  -- 10) 擦除后、删号前（正本 13 条，标签逐字照抄）
  perform drill_assert('api-usage-for-user-gone', 0,
    (select count(*)::int from public.api_usage where user_id = v_uid));
  perform drill_assert('api-usage-other-kept', 1,
    (select count(*)::int from public.api_usage where user_id = v_other_owner));
  perform drill_assert('contact-drill-gone', 0,
    (select count(*)::int from public.contact_messages where lower(btrim(email)) = 'drill.erase@example.test'));
  perform drill_assert('contact-other-kept', 1,
    (select count(*)::int from public.contact_messages where email = 'other-occupant@example.test'));
  perform drill_assert('audit-rows-still-present', 4,
    (select count(*)::int from public.audit_logs where action like 'drill.%'));
  perform drill_assert('audit-user-id-anonymised', 3,
    (select count(*)::int from public.audit_logs where action like 'drill.%' and user_id is null));
  perform drill_assert('audit-self-entity-nulled', 1,
    (select count(*)::int from public.audit_logs where action = 'drill.account.login' and entity_id is null));
  perform drill_assert('audit-other-entity-kept', 1,
    (select count(*)::int from public.audit_logs where action = 'drill.project.updated' and entity_id = 'project-42'));
  perform drill_assert('audit-pii-keys-stripped', 1,
    (select count(*)::int from public.audit_logs
      where action = 'drill.account.login'
        and not (metadata ? 'email' or metadata ? 'ip' or metadata ? 'user_agent')
        and metadata ->> 'keepMe' = 'session-a'
        and metadata ? 'ipAddressKept'));
  perform drill_assert('audit-object-keeps-name', 1,
    (select count(*)::int from public.audit_logs
      where action = 'drill.project.updated' and metadata ->> 'name' = 'kept-field'
        and not (metadata ? 'avatar_url')));
  perform drill_assert('audit-non-object-cleared', 1,
    (select count(*)::int from public.audit_logs where action = 'drill.legacy.shape' and metadata = '{}'::jsonb));
  perform drill_assert('audit-other-user-untouched', 1,
    (select count(*)::int from public.audit_logs
      where action = 'drill.other.login' and user_id = v_other_owner and metadata ? 'email'));
  perform drill_assert('profile-still-exists-before-delete', 1,
    (select count(*)::int from public.profiles where id = v_uid));

  -- 11) 再删号（等价于 auth.admin.deleteUser 触发的级联）
  delete from auth.users where id = v_uid;

  -- 12) 删号后（正本 7 条）
  perform drill_assert('profile-cascaded', 0,
    (select count(*)::int from public.profiles where id = v_uid));
  perform drill_assert('metadata-rows-outlive-account', 2,
    (select count(*)::int from public.upload_objects
      where owner_id is null and object_key in (v_avatar_key, v_orphan_key)));
  perform drill_assert('orphan-list-sees-leftover-avatar', 1,
    (select count(*)::int from public.find_orphan_upload_objects() where object_key = v_avatar_key));
  perform drill_assert('deleted-row-not-listed', 0,
    (select count(*)::int from public.find_orphan_upload_objects() where object_key = v_orphan_key));
  perform drill_assert('other-owner-object-untouched', 0,
    (select count(*)::int from public.find_orphan_upload_objects() where object_key = 'covers/drill-team-shared.png'));
  perform drill_assert('team-project-still-references-cover', 1,
    (select count(*)::int from public.projects
      where slug like 'drill-team-%' and logo_url like '%covers/drill-team-shared.png'));
  perform drill_assert('audit-fact-survives-delete', 4,
    (select count(*)::int from public.audit_logs where action like 'drill.%'));

  -- 13) 报告借 raise exception 的消息通道回传（实测 raise notice 不回传），
  --     同时这一句就是**回滚本身**：整条语句失败 ⇒ 上面所有写入都不留。
  select count(*) into n_fail from drill_fail;
  select coalesce(string_agg(msg, ' | '), 'ALL-20-ASSERTIONS-PASSED') into v_report from drill_fail;
  -- 刻意**不**把 v_info 塞进 format 的 %s：`assertions=20%` 后面紧跟空格时，
  -- PostgreSQL 把 `% ` 当成带 flag 的转换（实测会吃掉那个空格并多消费一个参数）。
  -- 报告串用 || 拼，读起来也更直白。
  raise exception 'DRILL-RESULT %', 'failures=' || n_fail || ' assertions=20' || v_info || ' report=' || v_report;
end
$drill$;
