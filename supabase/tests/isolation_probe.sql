-- =============================================================================
-- 隔离矩阵（二）：push_subscriptions / webauthn_credentials / subscriptions
--
-- 这三张表此前的覆盖只有 036 / 037 / rbac 三个探针之外的**静态扫描**。
-- 补这组用例的理由不是「凑覆盖率」，而是这三张表各自守住一件具体的事：
--   - push_subscriptions：设备推送端点绑在 user_id 上，写成别人的就是「替别人收推送」；
--   - webauthn_credentials：通行密钥的公钥行，写成别人的就是「让别人的账号多一把钥匙」；
--   - subscriptions：团队计费状态，客户端**只读**，任何写入都应当被拒
--     （Stripe webhook 走 service_role）。
--
-- 读数（`000_helpers.sql`）：0 = USING 没放行、-1 = WITH CHECK / 权限拒绝（42501）、
-- > 0 = 真的落库 / 真的看得见。
-- =============================================================================

begin;

truncate probe.case;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000b0001', 'a@isolation.probe'),
  ('00000000-0000-4000-8000-0000000b0002', 'b@isolation.probe'),
  ('00000000-0000-4000-8000-0000000b0003', 'c@isolation.probe');

insert into public.teams (id, name, slug, owner_id) values
  ('00000000-0000-4000-8000-0000000c0101', 'Iso T1', 'iso-t1',
   '00000000-0000-4000-8000-0000000b0001'),
  ('00000000-0000-4000-8000-0000000c0102', 'Iso T2', 'iso-t2',
   '00000000-0000-4000-8000-0000000b0003');

insert into public.team_members (team_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000c0101', '00000000-0000-4000-8000-0000000b0001', 'owner'),
  ('00000000-0000-4000-8000-0000000c0101', '00000000-0000-4000-8000-0000000b0002', 'member'),
  ('00000000-0000-4000-8000-0000000c0102', '00000000-0000-4000-8000-0000000b0003', 'owner');

-- 夹具：各自一条既有行（超级用户写入，绕过 RLS）
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth) values
  ('00000000-0000-4000-8000-0000000d0101', '00000000-0000-4000-8000-0000000b0001',
   'https://push.example/a', 'key-a', 'auth-a'),
  ('00000000-0000-4000-8000-0000000d0102', '00000000-0000-4000-8000-0000000b0002',
   'https://push.example/b', 'key-b', 'auth-b');

insert into public.webauthn_credentials (id, user_id, credential_id, public_key, counter) values
  ('00000000-0000-4000-8000-0000000d0201', '00000000-0000-4000-8000-0000000b0001',
   'cred-a', 'pk-a', 0),
  ('00000000-0000-4000-8000-0000000d0202', '00000000-0000-4000-8000-0000000b0002',
   'cred-b', 'pk-b', 0);

insert into public.subscriptions (id, team_id, provider, status, plan) values
  ('00000000-0000-4000-8000-0000000d0301', '00000000-0000-4000-8000-0000000c0101',
   'stripe', 'active', 'pro'),
  ('00000000-0000-4000-8000-0000000d0302', '00000000-0000-4000-8000-0000000c0102',
   'stripe', 'active', 'pro');

\o /dev/null

-- ---------------------------------------------------------------------------
-- push_subscriptions：推送端点只能绑在自己名下
-- ---------------------------------------------------------------------------
select probe.expect('push: 登记自己的端点 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth)
     values ('00000000-0000-4000-8000-0000000d0111',
             '00000000-0000-4000-8000-0000000b0001', 'https://push.example/a2', 'k', 'a')$q$), 1);

select probe.expect('push: 给别人登记端点 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth)
     values ('00000000-0000-4000-8000-0000000d0112',
             '00000000-0000-4000-8000-0000000b0002', 'https://push.example/forged', 'k', 'a')$q$), -1);

select probe.expect('push: 把自己的端点改给别人 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$update public.push_subscriptions set user_id = '00000000-0000-4000-8000-0000000b0002'
       where id = '00000000-0000-4000-8000-0000000d0101'$q$), -1);

select probe.expect('push: 删别人的端点 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$delete from public.push_subscriptions
       where id = '00000000-0000-4000-8000-0000000d0102'$q$), 0);

select probe.expect('push: 读别人的端点 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000b0001',
  $q$select 1 from public.push_subscriptions
     where id = '00000000-0000-4000-8000-0000000d0102'$q$), 0);

-- ---------------------------------------------------------------------------
-- webauthn_credentials：通行密钥只能挂在自己账号上
-- ---------------------------------------------------------------------------
select probe.expect('passkey: 给自己加一把 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$insert into public.webauthn_credentials (id, user_id, credential_id, public_key, counter)
     values ('00000000-0000-4000-8000-0000000d0211',
             '00000000-0000-4000-8000-0000000b0001', 'cred-a2', 'pk', 0)$q$), 1);

select probe.expect('passkey: 给别人加一把 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$insert into public.webauthn_credentials (id, user_id, credential_id, public_key, counter)
     values ('00000000-0000-4000-8000-0000000d0212',
             '00000000-0000-4000-8000-0000000b0002', 'cred-forged', 'pk', 0)$q$), -1);

select probe.expect('passkey: 删别人的密钥 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$delete from public.webauthn_credentials
       where id = '00000000-0000-4000-8000-0000000d0202'$q$), 0);

select probe.expect('passkey: 读别人的密钥 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000b0001',
  $q$select 1 from public.webauthn_credentials
     where id = '00000000-0000-4000-8000-0000000d0202'$q$), 0);

-- ---------------------------------------------------------------------------
-- subscriptions：客户端只读（写入只能来自 Stripe webhook 的 service_role）
-- ---------------------------------------------------------------------------
select probe.expect('subscriptions: 队友可读 -> 1', probe.read(
  '00000000-0000-4000-8000-0000000b0002',
  $q$select 1 from public.subscriptions
     where team_id = '00000000-0000-4000-8000-0000000c0101'$q$), 1);

select probe.expect('subscriptions: 外队不可读 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000b0003',
  $q$select 1 from public.subscriptions
     where team_id = '00000000-0000-4000-8000-0000000c0101'$q$), 0);

-- 读数是 **0** 而不是 -1，这个差别本身有用：`subscriptions` 上没有 UPDATE 策略，
-- 于是客户端改计费状态是「命中 0 行、error 为 null」——**静默失败**，不是报错。
-- 今天它是安全的（也没有任何客户端代码去改订阅，写入只来自 Stripe webhook 的 service_role），
-- 但这条用例把形状记下来了：将来谁用用户作用域客户端去改订阅，它会安静地什么都不做，
-- 而不是抛一个能被人看见的错误。0 与 -1 在这里不是同一个「拒绝」。
select probe.expect('subscriptions: 客户端升级 plan -> 0 行（静默）', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$update public.subscriptions set plan = 'enterprise'
       where team_id = '00000000-0000-4000-8000-0000000c0101'$q$), 0);

select probe.expect('subscriptions: 客户端插入订阅 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000b0001',
  $q$insert into public.subscriptions (team_id, provider, status, plan)
     values ('00000000-0000-4000-8000-0000000c0101', 'stripe', 'active', 'enterprise')$q$), -1);

\o
select probe.verify('隔离矩阵（二）：push / passkey / subscriptions');

rollback;
