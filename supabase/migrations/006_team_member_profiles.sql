-- =============================================================================
-- 团队成员资料可见性迁移（适用于已应用 001-005 的数据库）
-- 背景：profiles 原有 RLS 仅允许查看自己的 profile（auth.uid() = id），
--   导致团队管理页 / /api/invitations / getTeamMembers() 通过嵌入查询
--   （profiles:user_id）只能拿到当前用户自己的资料，其他成员的
--   email / full_name / avatar_url 在真实环境中恒为 null（mock 无 RLS 正常）。
-- 修复：新增"同团队成员可查看队友 profile"的 SELECT 策略（行业标准协作做法），
--   更新仍仅限本人。非团队用户、未登录用户不受影响。
-- 注：001 已同步修复，本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

drop policy if exists "Team members can view teammate profiles" on public.profiles;

create policy "Team members can view teammate profiles"
  on public.profiles for select
  using (
    -- 目标用户与当前用户同属至少一个团队
    exists (
      select 1 from public.team_members tm
      where tm.user_id = profiles.id
        and tm.team_id in (
          select team_id from public.team_members
          where user_id = auth.uid()
        )
    )
  );

commit;
