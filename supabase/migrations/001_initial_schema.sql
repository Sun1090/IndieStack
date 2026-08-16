-- =============================================================================
-- IndieStack - Initial Database Schema
-- =============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- Profiles table (extends Supabase auth.users)
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  role        text not null default 'user' check (role in ('user', 'admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Auto-create profile on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles 旧值读取辅助函数（security definer + search_path='' 防注入）
-- 用途：UPDATE 策略 WITH CHECK 中比较"更新前旧值"，防止通过 RLS 修改
--   role / email（email 是 auth.users 镜像，防止邀请错乱）。
-- 必须封装为函数：策略内直接以子查询引用 profiles 自身会触发
--   "infinite recursion detected in policy"（RLS 递归检测），导致更新整体失败。
create or replace function public.get_profile_role(p_id uuid)
returns text
language sql
security definer set search_path = ''
as $$ select role from public.profiles where id = p_id $$;

create or replace function public.get_profile_email(p_id uuid)
returns text
language sql
security definer set search_path = ''
as $$ select email from public.profiles where id = p_id $$;

-- Profiles RLS policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = public.get_profile_role(auth.uid())
    and email is not distinct from public.get_profile_email(auth.uid())
  );

-- Updated_at trigger
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Sessions tracking
create table public.user_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
alter table public.user_sessions enable row level security;

create policy "Users can view own sessions"
  on public.user_sessions for select
  using (auth.uid() = user_id);

-- API usage tracking (for rate limiting / analytics)
create table public.api_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  path        text not null,
  method      text not null,
  status_code smallint,
  ip_address  inet,
  created_at  timestamptz not null default now()
);

create index idx_api_usage_user_id on public.api_usage(user_id);
create index idx_api_usage_created_at on public.api_usage(created_at);

alter table public.api_usage enable row level security;

create policy "Users can view own api usage"
  on public.api_usage for select
  using (auth.uid() = user_id);

-- =============================================================================
-- Teams
-- =============================================================================
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  member_count integer not null default 1,
  plan        text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.teams enable row level security;

-- =============================================================================
-- Team Members
-- =============================================================================
create table public.team_members (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique(team_id, user_id)
);
alter table public.team_members enable row level security;

-- 团队判定辅助函数（security definer + search_path='' 防注入，内部显式限定 schema）
-- 用途：RLS 策略中判断"当前用户是否属于/管理某团队"。
-- 必须封装为函数：策略若直接引用 team_members 自身会触发
-- "infinite recursion detected in policy"（RLS 递归检测），导致团队相关查询整体不可用。
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_team_owner(p_team_id uuid)
returns boolean
language sql
security definer set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = auth.uid()
      and tm.role = 'owner'
  );
$$;

create policy "Team members can view members"
  on public.team_members for select
  using (public.is_team_member(team_members.team_id));

create policy "Team admins can invite members"
  on public.team_members for insert
  with check (
    public.is_team_admin(team_members.team_id)
    and (
      team_members.role <> 'owner'
      or public.is_team_owner(team_members.team_id)
    )
  );

create policy "Team admins can remove members"
  on public.team_members for delete
  using (
    public.is_team_admin(team_members.team_id)
    and team_members.role <> 'owner'
  );

-- 成员可退出团队（仅本人、非 owner；owner 需转移所有权或删除团队）
create policy "Team members can leave team"
  on public.team_members for delete
  using (auth.uid() = user_id and role <> 'owner');

-- 团队成员可查看同团队成员的资料（协作场景：团队页/邀请列表需要显示成员邮箱、姓名、头像）
-- 更新仍仅限本人；非团队用户、未登录用户不可见
create policy "Team members can view teammate profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.team_members tm
      where tm.user_id = profiles.id
        and tm.team_id in (
          select team_id from public.team_members
          where user_id = auth.uid()
        )
    )
  );


-- teams 旧值读取辅助函数（security definer + search_path='' 防注入）
-- 用途：teams UPDATE 策略 WITH CHECK 中比较"更新前旧值"，防止通过 RLS
--   修改 owner_id / plan / member_count（业务派生或计费字段）。
-- 必须封装为函数：策略内直接以子查询引用 teams 自身会触发 RLS 无限递归。
create or replace function public.get_team_owner_id(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select owner_id from public.teams where id = p_id $$;

create or replace function public.get_team_plan(p_id uuid)
returns text
language sql
security definer set search_path = ''
as $$ select plan from public.teams where id = p_id $$;

create or replace function public.get_team_member_count(p_id uuid)
returns integer
language sql
security definer set search_path = ''
as $$ select member_count from public.teams where id = p_id $$;

-- Team 策略（依赖 team_members 表，需在其后创建）
create policy "Team members can view their team"
  on public.teams for select
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
        and tm.user_id = auth.uid()
    )
  );

create policy "Team owners and admins can update their team"
  on public.teams for update
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
    and owner_id = public.get_team_owner_id(teams.id)
    and plan = public.get_team_plan(teams.id)
    and member_count = public.get_team_member_count(teams.id)
  );

-- Auto-create personal team for new users
create or replace function public.handle_new_team()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  team_slug text;
begin
  team_slug := 'personal-' || replace(new.id::text, '-', '');
  insert into public.teams (name, slug, owner_id)
  values ('Personal', team_slug, new.id);
  insert into public.team_members (team_id, user_id, role)
  values (
    (select id from public.teams where slug = team_slug),
    new.id,
    'owner'
  );
  return new;
end;
$$;

create trigger on_auth_user_created_team
  after insert on auth.users
  for each row execute function public.handle_new_team();

-- =============================================================================
-- Subscriptions / Billing
-- =============================================================================
create table public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  provider        text not null default 'stripe',
  provider_id     text,
  status          text not null default 'inactive' check (status in ('active', 'canceled', 'past_due', 'inactive', 'trialing')),
  plan            text not null check (plan in ('free', 'pro', 'enterprise')),
  period_start    timestamptz,
  period_end      timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

create policy "Team members can view subscriptions"
  on public.subscriptions for select
  using (
    auth.uid() in (
      select user_id from public.team_members where team_id = subscriptions.team_id
    )
  );

-- Apply trigger for updated_at on teams and subscriptions
create trigger set_updated_at_teams
  before update on public.teams
  for each row execute function public.handle_updated_at();

create trigger set_updated_at_subscriptions
  before update on public.subscriptions
  for each row execute function public.handle_updated_at();

-- Webhook upsert 依赖 provider_id 唯一索引
create unique index if not exists idx_subscriptions_provider_id
  on public.subscriptions(provider_id);

-- =============================================================================
-- Profile extensions (additional columns)
-- =============================================================================
alter table public.profiles
  add column if not exists bio text,
  add column if not exists timezone text default 'UTC',
  add column if not exists language text default 'en',
  add column if not exists notification_settings jsonb default '{
    "emailNotifications": true,
    "marketingEmails": false,
    "productUpdates": true,
    "securityAlerts": true
  }'::jsonb;
