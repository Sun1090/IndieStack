-- 账户删除端到端演练（E09 / H08 / A10）
--
-- 为什么需要它：`/api/health` 全绿、页面全部可用、5xx 为零，都不能证明「先擦除、再删号」
-- 这条顺序成立，也不能证明它没有多删。v0.11.0 唯一的不可逆面就是这里，所以它必须能被
-- 反复演练并留下可核对的结果，而不是只在评审时被人读一遍 SQL。
--
-- 运行方式（本地 Supabase 栈；整段包在 begin/rollback 里，跑完不留数据）：
--   docker exec -i supabase_db_indiestack psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < docs/operations/drills/account-erasure.sql
-- 也可用 `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres"` 直接连本地库。
--
-- 覆盖的断言：
--   - 擦除顺序：`profiles` 在擦除后、删号前仍然存在（否则无法证明是「先擦再删」）；
--   - 数据面：api_usage 删除、他人行保留；contact_messages 按 lower(btrim(email)) 命中
--     大小写/空格变体，他人邮箱保留；
--   - 审计：行不删、user_id 置空、指向本人的 entity_id 置空、指向他人的保留、
--     metadata 只剔 PII 键、非 object 的脏 metadata 整体清空；
--   - 对象：被引用（团队封面）一律保留，删号后元数据行活下来且 owner_id 为 null，
--     并出现在 find_orphan_upload_objects() 里等待补删；status='deleted' 的行不再出现；
--   - 权限：service_role 可调用；anon / authenticated 直接 permission denied
--     （那部分在文件外单跑，见 docs/db/retention.md 的演练记录）。
--
-- 顺序与 src/lib/account/deletion.ts 一致：对象清单 → 擦除 → 删号 → 事后核对
\set ON_ERROR_STOP on
begin;

create temp table d (uid uuid, uemail text, avatar_key text, orphan_key text, other_owner uuid);

-- 1) 两个隔离账户：本人的邮箱故意大小写混排，验证 lower(btrim()) 匹配
with new_user as (
  insert into auth.users (id, email) values (gen_random_uuid(), 'Drill.ErASE@Example.TEST') returning id, email
), other_user as (
  insert into auth.users (id, email) values (gen_random_uuid(), 'other-occupant@example.test') returning id
)
insert into d
select new_user.id, new_user.email,
       'avatars/' || new_user.id::text || '/drill.png',
       'avatars/' || new_user.id::text || '/leftover.png',
       other_user.id
from new_user, other_user;

-- 2) 资料：本人头像 URL 指向自己的对象；他人资料不参与
--    （auth.users 上有 on_auth_user_created 触发器已经建好 profiles 行，这里只补字段）
update public.profiles p
set email = d.uemail, full_name = 'Drill User', role = 'member',
    avatar_url = 'https://cdn.example.test/storage/v1/object/public/avatars/' || d.avatar_key
from d
where p.id = d.uid;

-- 3) api_usage：本人两条（含 IP）+ 他人一条（id 是 always identity，不能手写）
insert into public.api_usage (user_id, path, method, status_code, ip_address, created_at)
select uid, '/api/projects', 'GET', 200, '203.0.113.7'::inet, now() from d
union all
select uid, '/api/user', 'DELETE', 204, '203.0.113.8'::inet, now() from d
union all
select other_owner, '/api/projects', 'GET', 200, '203.0.113.9'::inet, now() from d;

-- 4) audit_logs：本人三行（PII object / 非本人 entity / 非 object metadata）+ 他人一行
insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata, created_at)
select uid, 'drill.account.login', 'user', uid::text,
       jsonb_build_object('email', 'drill.erase@example.test', 'ip', '203.0.113.7',
                          'user_agent', 'Mozilla/5.0', 'ipAddressKept', 'x', 'keepMe', 'session-a'),
       now()
from d
union all
select uid, 'drill.project.updated', 'project', 'project-42',
       jsonb_build_object('avatar_url', 'https://x/y.png', 'name', 'kept-field'), now() from d
union all
select uid, 'drill.legacy.shape', 'user', uid::text, '["not","an","object"]'::jsonb, now() from d
union all
select other_owner, 'drill.other.login', 'user', other_owner::text,
       jsonb_build_object('email', 'other-occupant@example.test'), now() from d;

-- 5) contact_messages：两种邮箱写法都属于本人，另一种属于他人（该表无外键，级联覆盖不到）
insert into public.contact_messages (name, email, subject, message, status)
select 'Drill', '  DRILL.eRASE@example.TEST  ', 'hi', 'padded address', 'new' from d
union all
select 'Drill', 'drill.erase@example.test', 'hi', 'plain address', 'resolved' from d
union all
select 'Other', 'other-occupant@example.test', 'hi', 'someone else', 'new' from d;

-- 6) upload_objects：被头像引用的一行、未被引用的一行、他人团队封面一行
insert into public.upload_objects (bucket, object_key, owner_id, byte_size, content_type, checksum, status, created_at)
select 'avatars', avatar_key, uid, 1234, 'image/png',
       '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now() from d
union all
select 'avatars', orphan_key, uid, 2345, 'image/png',
       '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now() from d
union all
select 'covers', 'covers/drill-team-shared.png', other_owner, 3456, 'image/png',
       '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'active', now() from d;

-- 6b) 他人团队项目引用同一 bucket 下的封面：删本人账户绝不能弄坏别人的页面
insert into public.projects (id, team_id, name, slug, status, visibility, logo_url, created_by, created_at, updated_at)
select gen_random_uuid(), tm.team_id, 'Drill Team Project',
       'drill-team-' || substr(d.other_owner::text, 1, 8), 'active', 'team',
       'https://cdn.example.test/storage/v1/object/public/covers/drill-team-shared.png',
       d.other_owner, now(), now()
from (select team_id from public.team_members where user_id = (select other_owner from d) limit 1) tm, d;

-- 取到 psql 变量：SET ROLE service_role 之后就读不到 temp 表了
select uid, avatar_key, orphan_key, other_owner from d \gset drill_

-- 7) 删号前：应用侧拿到的对象清单，referenced=false 才允许删
set role service_role;
\echo '--- list_user_objects_for_erasure（删号前清单）---'
select 'object-list' as check,
       jsonb_agg(jsonb_build_object('key', right(object_key, 12), 'referenced', referenced)
                 order by object_key) as result
from public.list_user_objects_for_erasure(:'drill_uid'::uuid);
select 'reference-detection' as check,
       jsonb_build_object(
         'avatarReferenced', public.upload_object_is_referenced(:'drill_avatar_key'),
         'leftoverReferenced', public.upload_object_is_referenced(:'drill_orphan_key'),
         'teamCoverReferenced', public.upload_object_is_referenced('covers/drill-team-shared.png'),
         'wildcardUnderscoreNotMatched', public.upload_object_is_referenced('xavatars/' || :'drill_uid' || '/drill.png'),
         'prefixTailNotMatched', public.upload_object_is_referenced('drill.png')
       ) as result;
reset role;

-- 8) 模拟「未引用对象已由 provider 删除」：元数据标记 deleted
update public.upload_objects set status = 'deleted'
where object_key = :'drill_orphan_key';

-- 9) 先擦除
set role service_role;
\echo '--- erase_user_data 返回计数 ---'
select 'erasure' as check, public.erase_user_data(:'drill_uid'::uuid) as result;
reset role;

\echo '--- 擦除后、删号前（期望 actual = expected）---'
select 'api-usage-for-user-gone' as check,
       (select count(*) from public.api_usage where user_id = :'drill_uid'::uuid) as actual,
       0::bigint as expected
union all
select 'api-usage-other-kept',
       (select count(*) from public.api_usage where user_id = :'drill_other_owner'::uuid), 1
union all
select 'contact-drill-gone',
       (select count(*) from public.contact_messages where lower(btrim(email)) = 'drill.erase@example.test'), 0
union all
select 'contact-other-kept',
       (select count(*) from public.contact_messages where email = 'other-occupant@example.test'), 1
union all
select 'audit-rows-still-present',
       (select count(*) from public.audit_logs where action like 'drill.%'), 4
union all
select 'audit-user-id-anonymised',
       (select count(*) from public.audit_logs where action like 'drill.%' and user_id is null), 3
union all
select 'audit-self-entity-nulled',
       (select count(*) from public.audit_logs where action = 'drill.account.login' and entity_id is null), 1
union all
select 'audit-other-entity-kept',
       (select count(*) from public.audit_logs where action = 'drill.project.updated' and entity_id = 'project-42'), 1
union all
select 'audit-pii-keys-stripped',
       (select count(*) from public.audit_logs
         where action = 'drill.account.login'
           and not (metadata ? 'email' or metadata ? 'ip' or metadata ? 'user_agent')
           and metadata ->> 'keepMe' = 'session-a'
           and metadata ? 'ipAddressKept'), 1
union all
select 'audit-object-keeps-name',
       (select count(*) from public.audit_logs
         where action = 'drill.project.updated' and metadata ->> 'name' = 'kept-field'
           and not (metadata ? 'avatar_url')), 1
union all
select 'audit-non-object-cleared',
       (select count(*) from public.audit_logs where action = 'drill.legacy.shape' and metadata = '{}'::jsonb), 1
union all
select 'audit-other-user-untouched',
       (select count(*) from public.audit_logs
         where action = 'drill.other.login' and user_id = :'drill_other_owner'::uuid
           and metadata ? 'email'), 1
union all
select 'profile-still-exists-before-delete',
       (select count(*) from public.profiles where id = :'drill_uid'::uuid), 1;

-- 10) 再删号（等价于 auth.admin.deleteUser 触发的级联）
delete from auth.users where id = :'drill_uid'::uuid;

\echo '--- 删号后（期望 actual = expected）---'
select 'profile-cascaded' as check,
       (select count(*) from public.profiles where id = :'drill_uid'::uuid) as actual, 0::bigint as expected
union all
select 'metadata-rows-outlive-account',
       (select count(*) from public.upload_objects
         where owner_id is null
           and object_key in (:'drill_avatar_key', :'drill_orphan_key')), 2
union all
select 'orphan-list-sees-leftover-avatar',
       (select count(*) from public.find_orphan_upload_objects()
         where object_key = :'drill_avatar_key'), 1
union all
select 'deleted-row-not-listed',
       (select count(*) from public.find_orphan_upload_objects()
         where object_key = :'drill_orphan_key'), 0
union all
select 'other-owner-object-untouched',
       (select count(*) from public.find_orphan_upload_objects()
         where object_key = 'covers/drill-team-shared.png'), 0
union all
select 'team-project-still-references-cover',
       (select count(*) from public.projects
         where slug like 'drill-team-%'
           and logo_url like '%covers/drill-team-shared.png'), 1
union all
select 'audit-fact-survives-delete',
       (select count(*) from public.audit_logs where action like 'drill.%'), 4;

rollback;
