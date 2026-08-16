-- =============================================================================
-- 修复 team_members 策略自引用导致的 RLS 无限递归（适用于已应用 001-008 的数据库）
-- 问题：team_members 的 SELECT / INSERT / DELETE 策略在 USING / WITH CHECK 中
--   直接引用 public.team_members 自身（如 "exists (select 1 from team_members ...)"），
--   PostgreSQL 对策略表达式执行时检测到对自身表的引用，报
--   "infinite recursion detected in policy for relation team_members"。
--   由于 teams / profiles / projects / team_invitations / subscriptions 的策略
--   均依赖查询 team_members，本缺陷会导致真实环境中团队相关读写整体不可用
--   （开发环境 mock 无 RLS，掩盖了该问题）。
-- 修复：将"当前用户是否属于/管理某团队"的判断封装为 SECURITY DEFINER 辅助函数，
--  函数以表 owner 身份执行内部查询（绕过 RLS），策略只调用函数，不再自引用表；
--  DELETE 策略直接使用 USING 旧行的 role 列，替代自引用子查询。
-- 注：001 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 团队判定辅助函数（security definer + search_path='' 防注入，内部显式限定 schema）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. 重建 team_members 三个自引用策略
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
  using (
    public.is_team_admin(team_members.team_id)
    and team_members.role <> 'owner'
  );

commit;
