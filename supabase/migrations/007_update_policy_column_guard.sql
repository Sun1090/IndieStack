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
-- 说明：管理员后台与 Stripe webhook 均使用 service_role（绕过 RLS），不受影响；
--   teams.member_count 由服务端在成员增删后重新计算写入（同样走 service_role）。
-- 注：001 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. profiles：用户只能更新自己的资料，且 role / email 必须保持不变
--    with check 中的子查询读取 UPDATE 前的行快照（MVCC），因此新值必须与旧值一致
-- -----------------------------------------------------------------------------
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid())
    and email is not distinct from (
      select email from public.profiles where id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 2. teams：owner/admin 可更新团队基本信息（name/slug 等），
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
    and owner_id = (select owner_id from public.teams where id = teams.id)
    and plan = (select plan from public.teams where id = teams.id)
    and member_count = (select member_count from public.teams where id = teams.id)
  );

commit;
