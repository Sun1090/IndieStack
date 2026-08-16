-- =============================================================================
-- 项目 & 通知 & 索引完善 迁移
-- 在 001_initial_schema.sql 和 002_rbac_audit.sql 基础上增加：
--   - projects 表（项目管理和多租户隔离）
--   - notifications 表（用户通知系统）
--   - profiles.email 索引
--   - 相关 RLS、索引、触发器
-- =============================================================================

-- =============================================================================
-- 1. 项目表
-- =============================================================================
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  name        text not null,
  slug        text not null,
  description text default '',
  logo_url    text,
  status      text not null default 'active' check (status in ('active', 'archived', 'paused')),
  visibility  text not null default 'private' check (visibility in ('private', 'public', 'team')),
  config      jsonb default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(team_id, slug)
);
alter table public.projects enable row level security;

create index idx_projects_team_id on public.projects(team_id);
create index idx_projects_status on public.projects(status);
create index idx_projects_created_at on public.projects(created_at desc);

-- projects 旧值读取辅助函数（security definer + search_path='' 防注入）
-- 用途：projects UPDATE 策略 WITH CHECK 中比较"更新前旧值"，防止通过 RLS
--   把项目 team_id 改到其他团队（跨租户转移）或篡改 created_by。
-- 必须封装为函数：策略内直接以子查询引用 projects 自身会触发
--   "infinite recursion detected in policy"（RLS 递归检测）。
create or replace function public.get_project_team_id(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select team_id from public.projects where id = p_id $$;

create or replace function public.get_project_created_by(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select created_by from public.projects where id = p_id $$;

create policy "Team members can view projects"
  on public.projects for select
  using (
    auth.uid() in (
      select user_id from public.team_members where team_id = projects.team_id
    ) or (
      visibility = 'public'
    )
  );

create policy "Team members can create projects"
  on public.projects for insert
  with check (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = projects.team_id and role in ('owner', 'admin')
    )
  );

create policy "Team members can update projects"
  on public.projects for update
  using (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = projects.team_id and role in ('owner', 'admin')
    )
  )
  with check (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = projects.team_id and role in ('owner', 'admin')
    )
    and team_id = public.get_project_team_id(projects.id)
    and created_by is not distinct from public.get_project_created_by(projects.id)
  );

create policy "Team admins can delete projects"
  on public.projects for delete
  using (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = projects.team_id and role in ('owner', 'admin')
    )
  );

-- =============================================================================
-- 2. 用户通知表
-- =============================================================================
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in (
    'system', 'team_invite', 'member_joined', 'billing_update',
    'project_update', 'deployment', 'security_alert', 'mention'
  )),
  title       text not null,
  body        text,
  link        text,
  metadata    jsonb default '{}'::jsonb,
  is_read     boolean not null default false,
  email_sent  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user_id on public.notifications(user_id);
create index idx_notifications_unread on public.notifications(user_id, is_read) where is_read = false;
create index idx_notifications_created_at on public.notifications(created_at desc);

alter table public.notifications enable row level security;

create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

create policy "Users can create own notifications"
  on public.notifications for insert
  with check (auth.uid() = user_id);

create policy "Users can mark own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 3. 完善索引
-- =============================================================================
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_created_at on public.profiles(created_at desc);
create index if not exists idx_user_sessions_user_id on public.user_sessions(user_id);
create index if not exists idx_subscriptions_team_id on public.subscriptions(team_id);

-- =============================================================================
-- 4. 项目创建审计触发器
-- =============================================================================
create or replace function public.handle_project_created()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    coalesce(new.created_by, auth.uid()),
    'project.create',
    'project',
    new.id::text,
    jsonb_build_object('name', new.name, 'team_id', new.team_id::text)
  );
  return new;
end;
$$;

create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_project_created();

create trigger set_updated_at_projects
  before update on public.projects
  for each row execute function public.handle_updated_at();

-- =============================================================================
-- 5. 通知清理函数
-- =============================================================================
create or replace function public.cleanup_old_notifications()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  delete from public.notifications
  where created_at < now() - interval '90 days'
    and is_read = true;
end;
$$;

-- =============================================================================
-- 6. 用户统计视图
-- =============================================================================
create or replace view public.user_stats
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
