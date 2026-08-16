-- =============================================================================
-- RBAC 权限系统 & 审计日志 迁移
-- 在 001_initial_schema.sql 基础上增加：
--   - 角色枚举和 profiles.role 更新
--   - 审计日志表（audit_logs）
--   - API 密钥表（api_keys）
--   - 用户邀请表（team_invitations）
--   - 相关 RLS、索引、触发器
-- =============================================================================

-- =============================================================================
-- 1. 更新 profiles 表的 role 约束
-- =============================================================================
-- 将 role 字段的 CHECK 约束扩展为支持新角色
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'member', 'viewer'));

-- 将已有记录的 'user' 角色迁移为 'member'
update public.profiles set role = 'member' where role = 'user';

-- 新用户默认角色同步为 'member'，避免默认值 'user' 违反新约束导致注册失败
alter table public.profiles alter column role set default 'member';

-- 重建 handle_new_user：显式写入 role，不依赖列默认值
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    'member'
  );
  return new;
end;
$$;

-- =============================================================================
-- 2. 审计日志表
-- =============================================================================
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  action      text not null,          -- 例如：'team.invite', 'project.delete', 'user.login'
  entity_type text not null,          -- 操作对象类型：'team', 'project', 'user', 'billing' 等
  entity_id   text,                   -- 操作对象 ID
  metadata    jsonb default '{}'::jsonb, -- 额外上下文，如 IP、user-agent、变更详情
  created_at  timestamptz not null default now()
);

-- 审计日志索引
create index idx_audit_logs_user_id on public.audit_logs(user_id);
create index idx_audit_logs_action on public.audit_logs(action);
create index idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);
create index idx_audit_logs_created_at on public.audit_logs(created_at desc);

-- 审计日志 RLS：仅 super_admin 可查看
alter table public.audit_logs enable row level security;

create policy "Audit logs viewable by super_admin"
  on public.audit_logs for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'super_admin'
    )
  );

create policy "Audit logs insertable by authenticated users"
  on public.audit_logs for insert
  with check (auth.role() = 'authenticated');

-- =============================================================================
-- 3. API 密钥表
-- =============================================================================
create table public.api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,          -- 密钥名称，如 "Production API Key"
  key_prefix  text not null,          -- 密钥前缀（用于显示），如 "isk_abc..."
  key_hash    text not null,          -- 密钥哈希（使用 pgcrypto 的 digest）
  scopes      text[] default '{}',    -- 权限范围，如 '{"project:read", "project:write"}'
  last_used_at timestamptz,
  expires_at  timestamptz,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 同一用户下密钥名称唯一
create unique index idx_api_keys_user_name on public.api_keys(user_id, name);

alter table public.api_keys enable row level security;

create policy "Users can view own API keys"
  on public.api_keys for select
  using (auth.uid() = user_id);

create policy "Users can create own API keys"
  on public.api_keys for insert
  with check (auth.uid() = user_id);

create policy "Users can update own API keys"
  on public.api_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own API keys"
  on public.api_keys for delete
  using (auth.uid() = user_id);

-- =============================================================================
-- 4. 团队邀请表
-- =============================================================================
create table public.team_invitations (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  email           text not null,
  role            text not null default 'member' check (role in ('admin', 'member')),
  invited_by      uuid not null references auth.users(id) on delete cascade,
  token           text not null unique,  -- 邀请令牌（用于接受邀请链接）
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at      timestamptz not null default (now() + interval '7 days'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_team_invitations_team_id on public.team_invitations(team_id);
create index idx_team_invitations_email on public.team_invitations(email);
create index idx_team_invitations_token on public.team_invitations(token);

alter table public.team_invitations enable row level security;

create policy "Team admins can view invitations"
  on public.team_invitations for select
  using (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = team_invitations.team_id and role in ('owner', 'admin')
    )
  );

create policy "Team admins can create invitations"
  on public.team_invitations for insert
  with check (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = team_invitations.team_id and role in ('owner', 'admin')
    )
  );

-- =============================================================================
-- 5. 审计日志辅助函数
-- =============================================================================

/**
 * 记录审计日志的辅助函数
 * 使用方式（需要在安全上下文中调用）：
 *   select log_audit_action('team.invite', 'team', $team_id, '{"email": "user@example.com"}'::jsonb);
 */
create or replace function public.log_audit_action(
  p_action text,
  p_entity_type text,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- =============================================================================
-- 6. 索引完善
-- =============================================================================

-- 为 profiles 表的 role 字段添加索引（频繁基于角色查询）
create index if not exists idx_profiles_role on public.profiles(role);

-- 为 teams 表的 owner_id 添加索引
create index if not exists idx_teams_owner_id on public.teams(owner_id);

-- 为 team_members 表的 user_id 和 team_id 添加索引
create index if not exists idx_team_members_user_id on public.team_members(user_id);
create index if not exists idx_team_members_team_id on public.team_members(team_id);
create index if not exists idx_team_members_role on public.team_members(role);

-- =============================================================================
-- 7. 种子数据：设置默认的 super_admin（需手动配置）
-- =============================================================================
-- 将 Supabase 管理面板中的第一个用户设为 super_admin（可选）
-- 取消注释以下语句以启用：
-- update public.profiles set role = 'super_admin'
-- where id in (select id from auth.users order by created_at asc limit 1)
-- and role = 'member';
