-- =============================================================================
-- 038: projects 可见性的角色口径——`visibility='public'` 取「站内共享」而非「站外可读」
--
-- 现状（003 建的策略，一直没动过）：
--
--   create policy "Team members can view projects"
--     on public.projects for select
--     using (auth.uid() in (团队成员) or (visibility = 'public'));
--
-- 这条策略**没有 `to` 子句**，PostgreSQL 的默认角色是 `PUBLIC`——也就是 anon 也算在内。
-- 于是 `visibility = 'public'` 这一支对**未登录访客**成立：只要某一行是 public，
-- 任何人都能读到它的全部列（name / description / config / team_id / created_by）。
--
-- 为什么这是缺陷而不是特性：**从来没有人决定过「公开」是站内还是站外**。
-- 反证在代码里：`createProject` 把 visibility 硬编码成 'private'，
-- `updateProject` 只接受 name / description / config，UI 只**显示**不**修改**，
-- 全仓也没有任何匿名读 projects 的消费方（营销页不读库）。
-- 也就是说这一支今天是**靠没人走到**而安全，不是靠策略挡住；
-- 将来谁接上公开项目的写入路径，未登录访客立刻就能读到。
--
-- 修法：把角色收窄到 `authenticated`，`visibility = 'public'` 的语义随之明确为
-- **站内共享**（任何登录用户可读，今天的行为不变），而不是站外可读。
-- 这是最保守的一档：不新增任何对外暴露面，也不删掉任何今天成立的能力。
--
-- 想改成「站外可读」的话，正确做法不是把这行 `to authenticated` 删回去，而是
--   ① 明确产品语义（哪些列可公开？要不要 SEO / 反枚举 / 缓存？）；
--   ② 单独加一条 `to anon` 的策略，且 `using` 里**只**放 visibility = 'public' 的列级视图
--      （列级收窄用 view 或 RPC，而不是让整行可读）；
--   ③ 在 CHANGELOG 里写清这是对外暴露面的扩大。
-- 也就是说：038 回滚一行就能回到「站外可读」，但那时应该伴着上面三件事一起做。
--
-- 读数（`supabase/tests/038_projects_visibility_probe.sql`，修前 → 修后）：
--   未登录访客读 public 项目：1 → 0
--   非成员的登录用户读 public 项目：1 → 1（站内共享不变）
--   团队成员读自己团队的 private 项目：1 → 1
--   非成员读别人 private 项目：0 → 0
-- =============================================================================

drop policy if exists "Team members can view projects" on public.projects;

create policy "Team members can view projects"
  on public.projects for select
  to authenticated
  using (
    auth.uid() in (
      select user_id from public.team_members
      where team_id = projects.team_id
    ) or (
      visibility = 'public'
    )
  );
