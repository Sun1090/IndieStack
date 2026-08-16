-- =============================================================================
-- 安全修复迁移（适用于已应用 001-003 的数据库）
-- 修复 001-003 中发现的 RLS / 权限问题：
--   - teams / team_members 策略列名未限定导致的越权（恒真/恒假）
--   - api_usage 未启用 RLS（全站请求记录暴露）
--   - profiles.role 默认值与约束不一致导致注册回滚
--   - notifications 插入策略过宽（可为任意用户插入通知）
--   - user_stats 视图未使用 security_invoker（可能绕过底层 RLS）
--   - subscriptions.provider_id 唯一索引（webhook upsert 依赖）
-- 注：001-003 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. teams 查看策略（原 team_id = id 恒假 → 用户无法通过 RLS 看到自己的团队）
-- -----------------------------------------------------------------------------
drop policy if exists "Team members can view their team" on public.teams;

create policy "Team members can view their team"
  on public.teams for select
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
        and tm.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 2. team_members 策略（原 team_id = team_id 恒真 → 任意登录用户可查看/操作全站成员）
-- -----------------------------------------------------------------------------
drop policy if exists "Team members can view members" on public.team_members;

create policy "Team members can view members"
  on public.team_members for select
  using (public.is_team_member(team_members.team_id));

drop policy if exists "Team admins can invite members" on public.team_members;

create policy "Team admins can invite members"
  on public.team_members for insert
  with check (
    public.is_team_admin(team_members.team_id)
    and (
      team_members.role <> 'owner'
      or public.is_team_owner(team_members.team_id)
    )
  );

drop policy if exists "Team admins can remove members" on public.team_members;

create policy "Team admins can remove members"
  on public.team_members for delete
  using (public.is_team_admin(team_members.team_id));

-- -----------------------------------------------------------------------------
-- 3. api_usage 启用 RLS 并添加自读策略（已启用则为 no-op）
-- -----------------------------------------------------------------------------
alter table public.api_usage enable row level security;

drop policy if exists "Users can view own api usage" on public.api_usage;

create policy "Users can view own api usage"
  on public.api_usage for select
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. profiles.role 默认值修复 + handle_new_user 显式写入 role
-- -----------------------------------------------------------------------------
alter table public.profiles alter column role set default 'member';

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

-- -----------------------------------------------------------------------------
-- 5. notifications 插入策略：仅允许用户创建自己的通知
-- -----------------------------------------------------------------------------
drop policy if exists "System can create notifications" on public.notifications;
drop policy if exists "Users can create own notifications" on public.notifications;

create policy "Users can create own notifications"
  on public.notifications for insert
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 6. user_stats 视图启用 security_invoker，遵守底层表 RLS
-- -----------------------------------------------------------------------------
drop view if exists public.user_stats;

create view public.user_stats
with (security_invoker = true) as
select
  p.id as user_id,
  p.email,
  p.full_name,
  p.role,
  p.created_at as joined_at,
  (select count(*) from public.user_sessions us where us.user_id = p.id) as session_count,
  (select count(*) from public.api_usage au where au.user_id = p.id) as api_call_count,
  (select count(*) from public.team_members tm where tm.user_id = p.id) as team_count
from public.profiles p;

-- -----------------------------------------------------------------------------
-- 7. subscriptions.provider_id 唯一索引（webhook upsert 依赖）
-- -----------------------------------------------------------------------------
create unique index if not exists idx_subscriptions_provider_id
  on public.subscriptions(provider_id);
