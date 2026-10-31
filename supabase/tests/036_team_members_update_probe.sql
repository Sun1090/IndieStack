-- =============================================================================
-- 036 的越权矩阵：team_members 的 UPDATE 到底怎么收口
--
-- 用法（`pnpm check:rls-probe` 会自动跑；也可手工）：
--   psql -h <sock> -p <port> -U postgres -d postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/036_team_members_update_probe.sql
--
-- 读数由 `000_helpers.sql` 定义：0 = USING 没放行（安静地什么都没改）、
-- -1 = WITH CHECK 拒绝（42501）、1 = 真的落库。
--
-- 036 之前的实测读数：八条**全部**是 0——包括两条业务上合法的更新。
-- 这就是「`.update()` 拿到 error=null 之后返回 ok()」的真身。
-- =============================================================================

begin;

truncate probe.case;

-- `select probe.expect(...)` 每条都会打一行空结果，把矩阵刷得看不清；
-- 只把 expect 的输出丢到 /dev/null，verify 的 NOTICE 走 stderr 不受影响。
\o /dev/null

-- 夹具：两个团队；T1 有 owner / admin / member，T2 的 owner 是团队外的人
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'owner@probe.local'),
  ('00000000-0000-4000-8000-00000000a002', 'admin@probe.local'),
  ('00000000-0000-4000-8000-00000000a003', 'member@probe.local'),
  ('00000000-0000-4000-8000-00000000a004', 'outsider@probe.local');

insert into public.teams (id, name, slug, owner_id) values
  ('00000000-0000-4000-8000-00000000b001', 'Probe T1', 'probe-t1',
   '00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-00000000b002', 'Probe T2', 'probe-t2',
   '00000000-0000-4000-8000-00000000a004');

insert into public.team_members (id, team_id, user_id, role) values
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a002', 'admin'),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a003', 'member'),
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000b002',
   '00000000-0000-4000-8000-00000000a004', 'owner');

-- 顺序有意义：会改动夹具角色的用例（降级 admin）必须排在最后，否则后续「以 admin 身份」
-- 的用例会因为自己已经不是 admin 而变成 0 行——看起来仍然「安全」，其实是断言打偏了。

-- 1. 普通成员改自己的角色：USING 不放行（他不是 admin）
select probe.expect('member 改自己 -> 0 行', probe.write(
  '00000000-0000-4000-8000-00000000a003',
  $q$update public.team_members set role = 'admin'
       where id = '00000000-0000-4000-8000-00000000c003'$q$), 0);

-- 2. 合法：admin 把普通成员提成 admin
select probe.expect('admin 改 member -> 1 行', probe.write(
  '00000000-0000-4000-8000-00000000a002',
  $q$update public.team_members set role = 'admin'
       where id = '00000000-0000-4000-8000-00000000c003'$q$), 1);

-- 3. 提权：admin 把自己改成 owner（check 约束放行 'owner'，只有策略能挡）
select probe.expect('admin 自提 owner -> 拒绝', probe.write(
  '00000000-0000-4000-8000-00000000a002',
  $q$update public.team_members set role = 'owner'
       where id = '00000000-0000-4000-8000-00000000c002'$q$), -1);

-- 4. owner 行不可被改：admin 想把 owner 降成 member（using 里的 role 是旧值）
select probe.expect('admin 降级 owner -> 0 行', probe.write(
  '00000000-0000-4000-8000-00000000a002',
  $q$update public.team_members set role = 'member'
       where id = '00000000-0000-4000-8000-00000000c001'$q$), 0);

-- 5. 顶替：admin 把成员行改成别人
select probe.expect('admin 改 user_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-00000000a002',
  $q$update public.team_members set user_id = '00000000-0000-4000-8000-00000000a004'
       where id = '00000000-0000-4000-8000-00000000c003'$q$), -1);

-- 6. 跨租户搬运：admin 把成员行搬到 T2
select probe.expect('admin 改 team_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-00000000a002',
  $q$update public.team_members set team_id = '00000000-0000-4000-8000-00000000b002'
       where id = '00000000-0000-4000-8000-00000000c003'$q$), -1);

-- 7. 外部人：两条团队都不是他的
select probe.expect('outsider 改任意 -> 0 行', probe.write(
  '00000000-0000-4000-8000-00000000a004',
  $q$update public.team_members set role = 'admin'
       where id = '00000000-0000-4000-8000-00000000c003'$q$), 0);

-- 8. 合法（放最后：它把夹具里的 admin 降成 member）
select probe.expect('owner 降 admin -> 1 行', probe.write(
  '00000000-0000-4000-8000-00000000a001',
  $q$update public.team_members set role = 'member'
       where id = '00000000-0000-4000-8000-00000000c002'$q$), 1);

\o
select probe.verify('036 team_members UPDATE 越权矩阵');

rollback;
