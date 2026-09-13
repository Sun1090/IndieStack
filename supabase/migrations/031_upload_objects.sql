-- =============================================================================
-- 031: 上传对象元数据（H02）
--
-- 背景：`avatars` bucket 里的对象此前只以「URL 字符串」的形式存在于业务表
-- （profiles.avatar_url / projects.logo_url，见 src/lib/uploads/service.ts）。
-- 这留下三个治理盲区：
--   1. 没有任何地方记录字节数 / MIME / 内容哈希，事后无法判断某个公开对象是否被替换；
--   2. 孤儿对象无法枚举——回写失败、进程被杀、替换旧头像都会留下永久可公开读取的对象；
--   3. 保留期、配额与审计没有数据来源，只能靠遍历 bucket 列表。
--
-- 处理：新增 `public.upload_objects`。每次 put 成功落一行（active）；
-- 替换旧对象或回滚删除对象时把对应行标记为 deleted，因此
-- `status = 'active'` 的行集合就是「数据库认为应该存在的对象」，可与 bucket 实际列表比对找孤儿。
--
-- 访问边界（server-only）：
--   本表 RLS 打开但**不建任何策略**，anon / authenticated 既读不到也写不了，
--   PostgREST 对这两类角色返回 0 行并拒绝写入。读写只走 service_role
--   （src/lib/repositories/upload-objects.ts 的 createAdminClient()，带 BYPASSRLS）。
--   与 email_worker_runs / push_delivery_attempts / webhook_events 同类，
--   已在 src/lib/security/rls-coverage.ts 的 SERVER_ONLY_TABLES 登记。
-- =============================================================================

create table if not exists public.upload_objects (
  id uuid primary key default gen_random_uuid(),
  -- 对象所属 bucket：当前只有 avatars（H05 的 storage 门禁保证不会出现未登记的 bucket）
  bucket text not null,
  -- provider 返回的对象键，形如 `avatars/<userId>/<时间戳>-<随机串>.<ext>`
  object_key text not null,
  -- 上传者：用于按用户清理，账号删除时级联删除元数据
  owner_id uuid not null references auth.users (id) on delete cascade,
  byte_size bigint not null check (byte_size > 0),
  content_type text not null,
  -- sha256(对象字节) 十六进制；同 key 内容替换时可检测，也可用于完整性校验
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  -- active=数据库认为对象应存在；deleted=已从 provider 删除或已被替换
  status text not null default 'active' check (status in ('active', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同一 bucket 内对象键唯一：重复写入同一 key 只刷新元数据，不产生第二行
  constraint upload_objects_bucket_key_unique unique (bucket, object_key)
);

-- 账号删除 / 按用户清理
create index if not exists idx_upload_objects_owner_status
  on public.upload_objects (owner_id, status);

-- 孤儿巡检：按 bucket 拉取 active 元数据
create index if not exists idx_upload_objects_bucket_status
  on public.upload_objects (bucket, status);

alter table public.upload_objects enable row level security;

create trigger upload_objects_updated_at before update on public.upload_objects
  for each row execute function public.handle_updated_at();

-- 纵深防御：本表只由 service_role 写入，客户端连表级写权限都不需要
revoke insert, update, delete, truncate on public.upload_objects from anon, authenticated;
