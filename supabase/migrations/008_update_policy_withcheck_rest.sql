-- =============================================================================
-- 补齐剩余 UPDATE 策略的 with check（适用于已应用 001-007 的数据库）
-- 与 007 同类的 RLS 纵深防御缺口：
--   - projects "Team members can update projects" 仅有 using 无 with check
--     → 团队成员可把项目 team_id 改到其他团队（跨租户转移）、篡改 created_by
--   - notifications "Users can mark own notifications" 仅有 using 无 with check
--     → 用户可把自己通知行的 user_id 改成他人（转移/伪造归属）
--   - api_keys "Users can update own API keys" 仅有 using 无 with check
--     → 用户可把密钥行 user_id 改成他人（转移归属，吊销/审计错乱）
-- 修复：为三个策略补充 with check，强制归属列不变；
--   business 层对这三个表的写操作均带 .eq("user_id") / .eq("team_id") 白名单，
--   本迁移是数据库层的纵深防御，不改变现有业务行为。
-- 注：002（api_keys）/ 003（projects、notifications）已同步修复，
--   本迁移仅用于已部署数据库的增量修复，幂等可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. projects：owner/admin 可更新项目，但 team_id / created_by 必须保持不变
-- -----------------------------------------------------------------------------
-- -----------------------------------------------------------------------------
-- 1. projects：owner/admin 可更新项目，但 team_id / created_by 必须保持不变
-- 说明：WITH CHECK 中不能直接以子查询引用 projects 自身（会触发 PostgreSQL
--   "infinite recursion detected in policy"），因此将"读取更新前旧值"封装为
--   SECURITY DEFINER 辅助函数；with check 中查询 team_members 依赖 009 已修复
--   team_members 策略递归（009 与 008 需一同应用）。
-- -----------------------------------------------------------------------------
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

drop policy if exists "Team members can update projects" on public.projects;

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

-- -----------------------------------------------------------------------------
-- 2. notifications：用户只能更新自己的通知，user_id 必须保持不变
-- -----------------------------------------------------------------------------
drop policy if exists "Users can mark own notifications" on public.notifications;

create policy "Users can mark own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. api_keys：用户只能更新自己的密钥，user_id 必须保持不变
-- -----------------------------------------------------------------------------
drop policy if exists "Users can update own API keys" on public.api_keys;

create policy "Users can update own API keys"
  on public.api_keys for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

commit;
