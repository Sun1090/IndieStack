-- =============================================================================
-- 补 team_members 的 UPDATE 策略（适用于已应用 001-035 的数据库）
--
-- 缺陷：`team_members` 有 SELECT / INSERT / DELETE 三条策略，**没有 FOR UPDATE**。
--   PostgREST 的 UPDATE 在 RLS 下不是报错而是命中 0 行、`error` 为 null，
--   于是 `updateMemberRole()` 走完 `.update()` 拿到 error=null 就 `ok()` 返回：
--   前端显示新角色，刷新打回原值。**静默的假成功**比报错更难被发现。
--
-- 为什么这件事必须和「运行时白名单」一起做（同一次改动里另一处）：
--   一旦补上 UPDATE 策略，`newRole: "owner"` 就**真的会写进去**——该参数是 TypeScript
--   联合类型，反序列化后只剩字符串，而 role 的 check 约束恰好放行 'owner'
--   ⇒ 一个 admin 一次请求即成为该团队的 owner（可再删掉原 owner）。
--   也就是说：**只补策略不做白名单，等于把一个假成功换成一次真提权。**
--
-- 策略口径（与 `updateMemberRole()` 的业务口径一致，不多不少）：
--   using     —— 调用者是本团队的 owner/admin，且**被改的这一行当前不是 owner**
--                （owner 角色不可被改：既不能降级，也不能被「改成 owner」后覆盖）
--   with check —— 新行仍需调用者是本团队 owner/admin；team_id / user_id 必须不变
--                （否则可把任意成员行搬到别的团队、或把别人顶替掉）；
--                role 只能是 admin / member。
--
-- 越权矩阵（`supabase/tests/036_team_members_update_probe.sql` 逐条实测）：
--   普通成员改自己 → 0 行；admin 改普通成员 → 1 行；admin 把自己改成 owner → 拒绝；
--   admin 改 owner 行 → 0 行；admin 改 user_id / team_id → 拒绝；owner 改 admin → 1 行。
--
-- 说明：WITH CHECK 中不能以子查询直接引用 team_members 自身（触发
--   "infinite recursion detected in policy"），因此旧值读取封装为 SECURITY DEFINER
--   函数，沿用 007 / 008 / 009 的既有写法。
-- 幂等：全部 create or replace / drop policy if exists，可重复执行。
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. 旧值读取辅助函数（security definer + search_path=''，内部显式限定 schema）
--
-- 只建策略里真正被引用的两个：没有第三个「顺手也建上」的 `get_team_member_role`——
-- 一个不被任何策略引用的 SECURITY DEFINER 函数在门禁眼里就是「服务端函数」，
-- 必须 revoke EXECUTE，否则它是 PostgREST `rpc()` 的一个入口。
-- `security-definer-grants` 门禁当场拦下了那个多余的函数，这正是它该做的事。
-- -----------------------------------------------------------------------------
create or replace function public.get_team_member_team_id(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select team_id from public.team_members where id = p_id $$;

create or replace function public.get_team_member_user_id(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select user_id from public.team_members where id = p_id $$;

-- -----------------------------------------------------------------------------
-- 2. 策略本体
--    注意 `using` 里的 `role` 是**被更新那一行的旧值**（PG 语义），
--    这正是「owner 行不可编辑」这条约束的落点。
-- -----------------------------------------------------------------------------
drop policy if exists "Team admins can update members" on public.team_members;

create policy "Team admins can update members"
  on public.team_members for update
  using (
    public.is_team_admin(team_id)
    and role <> 'owner'
  )
  with check (
    public.is_team_admin(team_id)
    and team_id = public.get_team_member_team_id(id)
    and user_id = public.get_team_member_user_id(id)
    and role in ('admin', 'member')
  );

commit;
