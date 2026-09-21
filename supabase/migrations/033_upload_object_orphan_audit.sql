-- =============================================================================
-- 033: 上传对象孤儿可发现性与账户删除后的元数据留存（A10）
--
-- 背景：031 把每次上传登记为 `upload_objects` 的一行，并声称「`status='active'` 的行
-- 集合就是数据库认为应该存在的对象」，但这句话在两个位置站不住：
--
--   1. `owner_id` 是 `not null references auth.users on delete cascade`（031）。用户删除
--      账户后，他上传过的对象元数据跟着级联消失——而对象本身还在 bucket 里、仍然公开可读。
--      也就是说：唯一一条「provider 删除失败」的线索，恰好被级联抹掉了。删号越彻底，
--      孤儿越不可见，隐私声明里「删除所有数据」就越无从证明。
--   2. 没有任何查询能回答「哪些 active 行已经不再被业务表引用」。引用关系只存在于
--      `profiles.avatar_url` / `projects.logo_url` 这两个完整 URL 字符串里（031 的设计），
--      所以孤儿只能靠遍历 bucket 猜。
--
-- 处理：
--   - `owner_id` 改为可空并把外键换成 `on delete set null`：元数据必须活过账户删除，
--     否则失败的删除无从补做。`upload_objects` 是 server-only（RLS 打开且零策略），
--     留存的是对象键与哈希，不是用户身份。
--   - `list_user_objects_for_erasure(uuid)`：删号前给应用侧一份「这个用户上传过什么、
--     现在还有没有被引用」。`referenced=false` 才可以删对象；`referenced=true`
--     （例如他替团队上传的项目封面）必须保留，否则删一个人的账户会弄坏别人团队的页面。
--   - `find_orphan_upload_objects()`：全库 active 行中已经没有任何业务行引用的集合，
--     供运维核对与补删（`pnpm audit:storage-orphans`）。
--   - 引用判定用 `right(url, length(key) + 1) = '/' || key` 的后缀相等，而不是 LIKE：
--     对象键里的 `_` 在 LIKE 里是单字符通配符，会把 `a_b.png` 匹配到 `axb.png`；
--     要求前面是 `/` 则排除 `.../xavatars/u/f.png` 这类尾巴巧合。
--
-- 权限：两个新函数都是 `security definer` + 空 `search_path`，`EXECUTE` 从
--   PUBLIC / anon / authenticated 收回，只给 service_role（它们跨行读全部 URL 列，
--   客户端可调用就是越权读取他人资料字段）。
-- =============================================================================

alter table public.upload_objects
  alter column owner_id drop not null;

alter table public.upload_objects
  drop constraint if exists upload_objects_owner_id_fkey;

alter table public.upload_objects
  add constraint upload_objects_owner_id_fkey
  foreign key (owner_id) references auth.users (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 引用判定：active 元数据是否仍被业务 URL 指着
-- -----------------------------------------------------------------------------

create or replace function public.upload_object_is_referenced(p_object_key text)
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.avatar_url is not null
      and right(p.avatar_url, length(p_object_key) + 1) = '/' || p_object_key
  ) or exists (
    select 1
    from public.projects pr
    where pr.logo_url is not null
      and right(pr.logo_url, length(p_object_key) + 1) = '/' || p_object_key
  );
$$;

create or replace function public.list_user_objects_for_erasure(p_user_id uuid)
returns table (bucket text, object_key text, referenced boolean)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'list_user_objects_for_erasure requires a user id';
  end if;

  return query
  select o.bucket, o.object_key,
         public.upload_object_is_referenced(o.object_key) as referenced
  from public.upload_objects o
  where o.owner_id = p_user_id
    and o.status = 'active'
  order by o.created_at;
end;
$$;

create or replace function public.find_orphan_upload_objects()
returns table (bucket text, object_key text, owner_id uuid, byte_size bigint, created_at timestamptz)
language plpgsql
stable
security definer set search_path = ''
as $$
begin
  return query
  select o.bucket, o.object_key, o.owner_id, o.byte_size, o.created_at
  from public.upload_objects o
  where o.status = 'active'
    and not public.upload_object_is_referenced(o.object_key)
  order by o.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 执行权限收口（与 028 / 032 同一结论）
-- -----------------------------------------------------------------------------

revoke all on function public.upload_object_is_referenced(text)
  from public, anon, authenticated;
revoke all on function public.list_user_objects_for_erasure(uuid)
  from public, anon, authenticated;
revoke all on function public.find_orphan_upload_objects()
  from public, anon, authenticated;

grant execute on function public.upload_object_is_referenced(text) to service_role;
grant execute on function public.list_user_objects_for_erasure(uuid) to service_role;
grant execute on function public.find_orphan_upload_objects() to service_role;
