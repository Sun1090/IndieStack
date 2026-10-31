-- =============================================================================
-- 跨租户隔离矩阵：007 / 008 那批 `with check` 到底有没有拦住该拦的写入
--
-- 007 / 008 的迁移注释写得很清楚：`profiles` 少 `with check` 就能自提权成 admin，
--  `teams` 少 `with check` 就能转手 owner / 白嫖 plan，`projects` 少 `with check`
--  就能把项目搬到别的团队。**但那三条判断此前只有迁移文本和代码评审**，
-- 没有任何一次执行读数。这个文件把它们变成矩阵。
--
-- 读数语义（`000_helpers.sql`）：0 = USING 没放行（安静地什么都没改）、
--  -1 = WITH CHECK 拒绝（42501）、> 0 = 真的落库 / 真的看得见。
--
-- 矩阵分四组：profiles（自提权）、teams（转手与计费字段）、projects（跨租户搬运）、
-- notifications / api_keys（归属列顶替）。
-- =============================================================================

begin;

truncate probe.case;

-- `select probe.expect(...)` 每条都会打一行空结果，把矩阵刷得看不清；
-- 只把 expect 的输出丢到 /dev/null，verify 的 NOTICE 走 stderr 不受影响。
\o /dev/null

-- 夹具：T1（A owner / B admin / C member），T2（D owner，A/B/C 都不是成员），E 没有任何团队
--
-- 注意：`auth.users` 上有两个真实触发器——`handle_new_user`（建 profiles 行）与
-- `handle_new_team`（给每个新用户建一个自己的团队 + owner 成员行）。夹具因此**不手写
-- profiles**：手写会撞 `profiles_pkey`，而「先删再插」会让探针不再反映真实建号路径。
-- 每个用户的自动团队与本矩阵无关，这里只用显式指定的 T1 / T2。
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f0001', 'a@rbac.local'),
  ('00000000-0000-4000-8000-0000000f0002', 'b@rbac.local'),
  ('00000000-0000-4000-8000-0000000f0003', 'c@rbac.local'),
  ('00000000-0000-4000-8000-0000000f0004', 'd@rbac.local'),
  ('00000000-0000-4000-8000-0000000f0005', 'e@rbac.local');

update public.profiles set full_name = 'Alice' where id = '00000000-0000-4000-8000-0000000f0001';
update public.profiles set full_name = 'Bob' where id = '00000000-0000-4000-8000-0000000f0002';
update public.profiles set full_name = 'Carol' where id = '00000000-0000-4000-8000-0000000f0003';
update public.profiles set full_name = 'Dave' where id = '00000000-0000-4000-8000-0000000f0004';
update public.profiles set full_name = 'Eve' where id = '00000000-0000-4000-8000-0000000f0005';

insert into public.teams (id, name, slug, owner_id, member_count, plan) values
  ('00000000-0000-4000-8000-0000000e0001', 'RBAC T1', 'rbac-t1',
   '00000000-0000-4000-8000-0000000f0001', 3, 'free'),
  ('00000000-0000-4000-8000-0000000e0002', 'RBAC T2', 'rbac-t2',
   '00000000-0000-4000-8000-0000000f0004', 1, 'free');

insert into public.team_members (team_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000f0001', 'owner'),
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000f0002', 'admin'),
  ('00000000-0000-4000-8000-0000000e0001', '00000000-0000-4000-8000-0000000f0003', 'member'),
  ('00000000-0000-4000-8000-0000000e0002', '00000000-0000-4000-8000-0000000f0004', 'owner');

insert into public.projects (id, team_id, name, slug, status, visibility, created_by) values
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000e0001',
   'T1 私有', 't1-private', 'active', 'private', '00000000-0000-4000-8000-0000000f0001'),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000e0001',
   'T1 公开', 't1-public', 'active', 'public', '00000000-0000-4000-8000-0000000f0001'),
  ('00000000-0000-4000-8000-0000000d0003', '00000000-0000-4000-8000-0000000e0002',
   'T2 私有', 't2-private', 'active', 'private', '00000000-0000-4000-8000-0000000f0004');

insert into public.notifications (id, user_id, type, title, is_read, email_sent) values
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-0000000f0001',
   'system', 'A 的通知', false, false),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-0000000f0004',
   'system', 'D 的通知', false, false);

insert into public.api_keys (id, user_id, name, key_prefix, key_hash) values
  ('00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000f0001',
   'A 的密钥', 'isk_aaa', 'hash-a');

-- ---------------------------------------------------------------------------
-- 1. profiles：自提权（007 补的 with check 必须把 role 钉住）
-- ---------------------------------------------------------------------------
select probe.expect('profiles: 改自己 role -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0003',
  $q$update public.profiles set role = 'admin'
       where id = '00000000-0000-4000-8000-0000000f0003'$q$), -1);

select probe.expect('profiles: 改自己 full_name -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0003',
  $q$update public.profiles set full_name = 'Carol 改名'
       where id = '00000000-0000-4000-8000-0000000f0003'$q$), 1);

select probe.expect('profiles: 改别人资料 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000f0003',
  $q$update public.profiles set full_name = '被改了'
       where id = '00000000-0000-4000-8000-0000000f0001'$q$), 0);

select probe.expect('profiles: 队友可见 -> 1', probe.read(
  '00000000-0000-4000-8000-0000000f0003',
  $q$select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000f0001'$q$), 1);

select probe.expect('profiles: 外队不可见 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000f0004',
  $q$select 1 from public.profiles where id = '00000000-0000-4000-8000-0000000f0001'$q$), 0);

-- ---------------------------------------------------------------------------
-- 2. teams：转手 / 白嫖（owner_id、plan、member_count 必须不可变）
-- ---------------------------------------------------------------------------
select probe.expect('teams: admin 改 name -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.teams set name = 'RBAC T1 改名'
       where id = '00000000-0000-4000-8000-0000000e0001'$q$), 1);

select probe.expect('teams: admin 改 owner_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.teams set owner_id = '00000000-0000-4000-8000-0000000f0002'
       where id = '00000000-0000-4000-8000-0000000e0001'$q$), -1);

select probe.expect('teams: admin 改 plan -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.teams set plan = 'enterprise'
       where id = '00000000-0000-4000-8000-0000000e0001'$q$), -1);

select probe.expect('teams: 外队改 name -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000f0004',
  $q$update public.teams set name = '别人改的'
       where id = '00000000-0000-4000-8000-0000000e0001'$q$), 0);

-- ---------------------------------------------------------------------------
-- 3. projects：跨租户搬运（008 补的 with check 必须把 team_id / created_by 钉住）
-- ---------------------------------------------------------------------------
select probe.expect('projects: member 改名字 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000f0003',
  $q$update public.projects set name = 'member 改的'
       where id = '00000000-0000-4000-8000-0000000d0001'$q$), 0);

select probe.expect('projects: admin 改名字 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.projects set name = 'admin 改的'
       where id = '00000000-0000-4000-8000-0000000d0001'$q$), 1);

select probe.expect('projects: admin 改 team_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.projects set team_id = '00000000-0000-4000-8000-0000000e0002'
       where id = '00000000-0000-4000-8000-0000000d0001'$q$), -1);

select probe.expect('projects: admin 改 created_by -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$update public.projects set created_by = '00000000-0000-4000-8000-0000000f0002'
       where id = '00000000-0000-4000-8000-0000000d0001'$q$), -1);

select probe.expect('projects: 外队读私有 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000f0004',
  $q$select 1 from public.projects where id = '00000000-0000-4000-8000-0000000d0001'$q$), 0);

select probe.expect('projects: 外队读公开 -> 1', probe.read(
  '00000000-0000-4000-8000-0000000f0004',
  $q$select 1 from public.projects where id = '00000000-0000-4000-8000-0000000d0002'$q$), 1);

-- 下面这条是**读数与直觉不符**的一条，写清楚它为什么是 1。
-- `Team members can view projects` 的 USING 是
--   `auth.uid() in (本队成员) or visibility = 'public'`
-- 而这条策略没写 `to authenticated`（本仓库所有策略都是 `to public`），
-- 于是 `visibility = 'public'` 这一支对 **anon 也成立**：未登录的互联网用户
-- 可以直接 `GET /rest/v1/projects?visibility=eq.public` 读到这些项目。
--
-- 今天这不算可利用的洞：`src/lib/actions/projects.ts` 建项目时硬写 `visibility: "private"`，
-- 没有 UI 也没有 Action 能把它改成 public，所以**现存数据里没有公开项目**。
-- 但它是一条**潜力通道**：任何将来把手伸向 visibility 的改动（新功能、手工 UPDATE、
-- 迁移回填）都会让那些项目对匿名用户可读，而且不会有任何门禁报警 ——
-- 这条用例存在的意义就是把这件事钉在明面上，而不是让它继续藏着。
-- 要收口有两条路（都属产品判断，不是这里单方面能定的）：
--   ① 把这条策略改成 `to authenticated`，让「公开」只对登录用户公开；
--   ② 保留现状，但把 `visibility` 定义成「站内共享」，并删掉这一支谓词。
select probe.expect('projects: anon 读公开 -> 1（见上方注释）', probe.read(
  null,
  $q$select 1 from public.projects where id = '00000000-0000-4000-8000-0000000d0002'$q$), 1);

-- ---------------------------------------------------------------------------
-- 4. notifications / api_keys：归属列顶替（008 补的 with check）
-- ---------------------------------------------------------------------------
select probe.expect('notifications: 标自己已读 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0001',
  $q$update public.notifications set is_read = true
       where id = '00000000-0000-4000-8000-0000000c0001'$q$), 1);

select probe.expect('notifications: 标别人已读 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000f0001',
  $q$update public.notifications set is_read = true
       where id = '00000000-0000-4000-8000-0000000c0002'$q$), 0);

select probe.expect('notifications: 改 user_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0001',
  $q$update public.notifications set user_id = '00000000-0000-4000-8000-0000000f0004'
       where id = '00000000-0000-4000-8000-0000000c0001'$q$), -1);

select probe.expect('api_keys: 改自己密钥 name -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0001',
  $q$update public.api_keys set name = 'A 的密钥（改名）'
       where id = '00000000-0000-4000-8000-0000000b1001'$q$), 1);

select probe.expect('api_keys: 改 user_id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0001',
  $q$update public.api_keys set user_id = '00000000-0000-4000-8000-0000000f0004'
       where id = '00000000-0000-4000-8000-0000000b1001'$q$), -1);

select probe.expect('api_keys: 别人删我的密钥 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000f0004',
  $q$delete from public.api_keys
       where id = '00000000-0000-4000-8000-0000000b1001'$q$), 0);

-- ---------------------------------------------------------------------------
-- 5. team_invitations：只有本队 owner/admin 能发邀请
-- ---------------------------------------------------------------------------
select probe.expect('invitations: 同队 member 发邀请 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0003',
  $q$insert into public.team_invitations
       (team_id, email, role, invited_by, token, status, expires_at)
     values ('00000000-0000-4000-8000-0000000e0001', 'x@rbac.local', 'member',
             '00000000-0000-4000-8000-0000000f0003', 'tok-1', 'pending', now() + interval '1 day')$q$), -1);

select probe.expect('invitations: 外队发邀请 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000f0004',
  $q$insert into public.team_invitations
       (team_id, email, role, invited_by, token, status, expires_at)
     values ('00000000-0000-4000-8000-0000000e0001', 'y@rbac.local', 'member',
             '00000000-0000-4000-8000-0000000f0004', 'tok-2', 'pending', now() + interval '1 day')$q$), -1);

select probe.expect('invitations: 本队 admin 发邀请 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000f0002',
  $q$insert into public.team_invitations
       (team_id, email, role, invited_by, token, status, expires_at)
     values ('00000000-0000-4000-8000-0000000e0001', 'z@rbac.local', 'member',
             '00000000-0000-4000-8000-0000000f0002', 'tok-3', 'pending', now() + interval '1 day')$q$), 1);

\o
select probe.verify('跨租户隔离矩阵（007 / 008 的 with check）');

rollback;
