-- =============================================================================
-- 032: 账户数据擦除与保留期补齐（H08）
--
-- 背景：隐私承诺与实现不一致。`messages/*/privacy.json` 向用户承诺删除账户后
-- 「30 天内删除或匿名化个人数据」，而账户删除链路（`DELETE /api/user` →
-- `admin.auth.admin.deleteUser()`）只依赖外键级联。级联覆盖不到三类个人数据：
--   1. `api_usage.user_id` 是 `on delete set null`（001），删号后行仍在，
--      并保留 `ip_address`（inet，个人数据）与访问路径，且该表此前无任何保留期；
--   2. `contact_messages` 只有裸 `email` 文本列、没有外键（012），删号后
--      以该邮箱提交的联系内容永久留存；
--   3. `audit_logs.user_id` 同样是 `on delete set null`（002），删号只切断了指向，
--      `metadata` 里仍可能带 `email` / `ip_address` / `user_agent`（002 的用法示例
--      本身就写入 `{"email": ...}`），并且 `entity_id` 可以直接是用户 id。
-- 另外两类无界增长：`upload_objects` 标记为 `deleted` 的元数据行（031 建表时只写了
-- 按 owner 检索的索引，从未清理）与 `status='resolved'` 的历史联系消息。
--
-- 处理：
--   - `erase_user_data(uuid)`：删号前先擦除上述三类个人数据。审计行按合规要求保留
--     行为事实（`action` / `entity_type` / `created_at`），但移除与个人的连接：
--     `user_id` 置空、`entity_id` 指向该用户时置空、`metadata` 剔除 PII 键。
--     返回各面受影响行数，供服务端记录与断言。
--   - `cleanup_old_api_usage()`：90 天，与 notifications / webhook_events /
--     email_worker_runs 的保留期对齐。
--   - `prune_deleted_upload_objects()`：`deleted` 元数据行保留 30 天，
--     足够一次孤儿巡检与对账，之后不再有意义。
--   - `cleanup_resolved_contact_messages()`：`resolved` 满 365 天的联系内容删除；
--     `new` / `in_progress` 永不清理（删除未处理的用户求助即静默丢单）。
--   - 为两个新的时间窗清理建局部索引，避免全表扫描。
--
-- 权限：以上函数均为 `security definer` + 空 `search_path`，并把 `EXECUTE` 从
--   PUBLIC / anon / authenticated 收回，只保留 service_role 与属主（沿用 028 的结论：
--   PostgreSQL 默认授予 PUBLIC，客户端可直接 `rpc()` 触发删除/擦除属于数据破坏面）。
--   清理调度沿用 014 / 027 的 pg_cron 守卫式写法，未安装 pg_cron 的环境自动跳过；
--   擦除是同步的账户删除步骤，由应用侧 service_role 调用，不依赖 pg_cron。
--
-- 门禁：`scripts/check-supabase-security.js` 对未撤权的 SECURITY DEFINER 函数失败封闭；
--   `src/lib/privacy/erasure-policy.ts` 是本迁移取值（保留期、cron 任务名、PII 键、
--   擦除面）的单一事实来源，由 `src/lib/privacy/erasure-policy.test.ts` 与 SQL、
--   `docs/db/retention.md` 双向比对。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 账户数据擦除
-- -----------------------------------------------------------------------------

create or replace function public.erase_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_email text;
  v_entity_id text;
  v_api_usage bigint := 0;
  v_contact_messages bigint := 0;
  v_audit_logs bigint := 0;
begin
  if p_user_id is null then
    raise exception 'erase_user_data requires a user id';
  end if;

  -- 只取邮箱用于匹配联系消息；不返回、不落库
  select lower(btrim(u.email))
    into v_email
  from auth.users u
  where u.id = p_user_id;

  v_entity_id := p_user_id::text;

  -- API 使用记录：整体删除。它既含 ip_address，也不参与任何合规留存要求。
  delete from public.api_usage
  where user_id = p_user_id;
  get diagnostics v_api_usage = row_count;

  -- 联系消息：按邮箱匹配删除（该表没有外键，级联覆盖不到）。
  if v_email is not null then
    delete from public.contact_messages
    where lower(btrim(email)) = v_email;
    get diagnostics v_contact_messages = row_count;
  end if;

  -- 审计日志：保留行为事实，切断与个人的连接。
  -- metadata 非 object（历史脏数据 / json 数组）时整体清空而不是按键剔除，
  -- 避免 `-` 运算符在非标量上报错中断整条擦除链路。
  update public.audit_logs
  set user_id = null,
      entity_id = case
        when entity_id = v_entity_id then null
        else entity_id
      end,
      metadata = case
        when jsonb_typeof(metadata) = 'object' then
          metadata - 'email' - 'ip' - 'ip_address' - 'user_agent'
                   - 'phone' - 'full_name' - 'avatar_url' - 'token'
        else '{}'::jsonb
      end
  where user_id = p_user_id;
  get diagnostics v_audit_logs = row_count;

  return jsonb_build_object(
    'apiUsage', v_api_usage,
    'contactMessages', v_contact_messages,
    'auditLogsAnonymized', v_audit_logs
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. 保留期清理
-- -----------------------------------------------------------------------------

create or replace function public.cleanup_old_api_usage()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.api_usage
  where created_at < now() - interval '90 days';
end;
$$;

create or replace function public.prune_deleted_upload_objects()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.upload_objects
  where status = 'deleted'
    and updated_at < now() - interval '30 days';
end;
$$;

create or replace function public.cleanup_resolved_contact_messages()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.contact_messages
  where status = 'resolved'
    and created_at < now() - interval '365 days';
end;
$$;

-- 清理条件都是「状态子集 + 时间窗」，用局部索引，不为一次性删除拖全表扫描
create index if not exists idx_upload_objects_deleted_at
  on public.upload_objects (updated_at)
  where status = 'deleted';

create index if not exists idx_contact_messages_resolved_created_at
  on public.contact_messages (created_at)
  where status = 'resolved';

-- -----------------------------------------------------------------------------
-- 3. pg_cron 调度（守卫式，任务名固定 => 重放迁移是更新而非新增任务）
--    与既有清理任务（04:00 / 04:15）错开，避免同一时刻叠加删除负载
-- -----------------------------------------------------------------------------

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'cleanup-old-api-usage',
      '30 4 * * 0',
      $$select public.cleanup_old_api_usage()$$
    );
    perform cron.schedule(
      'prune-deleted-upload-objects',
      '45 4 * * 0',
      $$select public.prune_deleted_upload_objects()$$
    );
    perform cron.schedule(
      'cleanup-resolved-contact-messages',
      '0 5 * * 0',
      $$select public.cleanup_resolved_contact_messages()$$
    );
  end if;
end
$do$;

-- -----------------------------------------------------------------------------
-- 4. 执行权限收口
-- -----------------------------------------------------------------------------

revoke all on function public.erase_user_data(uuid)
  from public, anon, authenticated;
revoke all on function public.cleanup_old_api_usage()
  from public, anon, authenticated;
revoke all on function public.prune_deleted_upload_objects()
  from public, anon, authenticated;
revoke all on function public.cleanup_resolved_contact_messages()
  from public, anon, authenticated;

grant execute on function public.erase_user_data(uuid) to service_role;
grant execute on function public.cleanup_old_api_usage() to service_role;
grant execute on function public.prune_deleted_upload_objects() to service_role;
grant execute on function public.cleanup_resolved_contact_messages() to service_role;
