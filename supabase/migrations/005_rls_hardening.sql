-- =============================================================================
-- RLS 纵深防御迁移（适用于已应用 001-004 的数据库）
-- 修复 001-004 中剩余的 RLS 权限缺口：
--   - team_members 删除策略允许 admin 移除团队所有者（应仅能通过转移/删除团队移除）
--   - 团队成员无法通过普通客户端退出团队（RLS 无自删策略，leaveTeam 对 member 恒失败）
--   - teams 更新策略仅限 owner，与业务层"owner 或 admin"不一致
-- 注：001 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. team_members 删除策略：禁止移除团队所有者（纵深防御，业务层已有兜底）
-- -----------------------------------------------------------------------------
drop policy if exists "Team admins can remove members" on public.team_members;

create policy "Team admins can remove members"
  on public.team_members for delete
  using (
    exists (
      select 1 from public.team_members tm
      where tm.team_id = team_members.team_id
        and tm.role in ('owner', 'admin')
        and tm.user_id = auth.uid()
    )
    and (
      select role from public.team_members
      where id = team_members.id
    ) <> 'owner'
  );

-- -----------------------------------------------------------------------------
-- 2. 新增"成员可退出团队"策略：仅本人、非 owner 可删除自己的成员记录
-- -----------------------------------------------------------------------------
drop policy if exists "Team members can leave team" on public.team_members;

create policy "Team members can leave team"
  on public.team_members for delete
  using (auth.uid() = user_id and role <> 'owner');

-- -----------------------------------------------------------------------------
-- 3. teams 更新策略：owner 或 admin（与 API PATCH 业务层权限一致）
-- -----------------------------------------------------------------------------
drop policy if exists "Team owners can update their team" on public.teams;
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
  );

commit;
