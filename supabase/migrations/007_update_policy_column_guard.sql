-- =============================================================================
-- 列级 UPDATE 策略加固迁移（适用于已应用 001-006 的数据库）
-- 修复 001-006 中 RLS 列级缺口：
--   - profiles "Users can update own profile" 仅有 using 无 with check
--     → 任意登录用户可用 anon key 把自己的 role 改为 super_admin/admin（自提权），
--       从而绕过所有后台权限守卫（safelyRequireRole("admin") 等）
--   - teams "Team owners and admins can update their team" 仅有 using 无 with check
--     → 团队成员可把 owner_id 转给他人、plan 改为 enterprise 白嫖、篡改 member_count
-- 修复：为两个策略补充 with check，禁止通过 RLS 修改
--   role / email（profiles，email 是 auth.users 镜像，防止邀请错乱）
--   owner_id / plan / member_count（teams，均为业务派生或计费字段）
-- 实现说明：WITH CHECK 中不能直接以子查询引用本表（会触发 PostgreSQL 的
--   "infinite recursion detected in policy"），因此将"读取更新前旧值"封装为
--   SECURITY DEFINER 辅助函数（以 owner 身份执行，内部查询不触发 RLS），
--   通过比较新值与旧值强制列不可变。管理员后台与 Stripe webhook 均使用
--   service_role（绕过 RLS），不受影响；teams.member_count 由服务端重算写入。
-- 注：001 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. profiles 旧值读取辅助函数
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. profiles：用户只能更新自己的资料，且 role / email 必须保持不变
-- -----------------------------------------------------------------------------
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = public.get_profile_role(auth.uid())
    and email is not distinct from public.get_profile_email(auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 3. teams 旧值读取辅助函数
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 4. teams：owner/admin 可更新团队基本信息（name/slug 等），
--    但 owner_id / plan / member_count 必须保持不变（防止转手/白嫖/篡改）
-- -----------------------------------------------------------------------------
drop policy if exists "Team owners and admins can update their team" on public.teams;

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

commit;
