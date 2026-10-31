-- =============================================================================
-- 037 的矩阵：user_sessions 的「登记 / 刷新 / 吊销」到底能不能用
--
-- 这条缺陷的形态值得单独说：它不是「越权放过了」，而是**功能从来没有工作过**。
-- `recordCurrentSession()` 用用户作用域客户端 upsert 这张表，而表上只有 SELECT / DELETE
-- 策略 ⇒ INSERT 被 RLS 拒绝（42501），登录回调 try/catch 吞掉、心跳 `void` 丢掉、
-- 设置页的「已登录设备」永远为空、`revokeSession` 永远答 `sessionNotFound`。
-- 只有真库能看见它：mock 没有 RLS。
--
-- 读数（`000_helpers.sql`）：0 = USING 没放行（安静地什么都没改）、
-- -1 = WITH CHECK / 权限拒绝（42501）、> 0 = 真的落库 / 真的看得见。
--
-- 037 之前的实测：`登记自己的会话` 是 **-1**（INSERT 被拒），其余写入同理。
-- =============================================================================

begin;

truncate probe.case;

-- 两个用户，各自一条既有会话行（由超级用户写入，绕过 RLS，等价于迁移前的历史数据）
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a0001', 'a@sessions.probe'),
  ('00000000-0000-4000-8000-0000000a0002', 'b@sessions.probe');

insert into public.user_sessions (id, user_id, user_agent) values
  ('00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000a0001', 'probe-a'),
  ('00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000a0002', 'probe-b');

\o /dev/null

-- 1. 登记自己的新设备：这是「设备管理」能不能存在的前提
select probe.expect('登记自己的会话 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$insert into public.user_sessions (id, user_id, user_agent, last_seen_at)
     values ('00000000-0000-4000-8000-0000000d1001',
             '00000000-0000-4000-8000-0000000a0001', 'probe-new', now())$q$), 1);

-- 2. 刷新同一设备（upsert 的冲突分支走 UPDATE 策略）：第二次必须也能写进
select probe.expect('刷新自己的会话 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$update public.user_sessions set last_seen_at = now()
       where id = '00000000-0000-4000-8000-0000000d1001'$q$), 1);

-- 3. 给别人登记会话：user_id 必须是自己
select probe.expect('替别人登记 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$insert into public.user_sessions (id, user_id, user_agent, last_seen_at)
     values ('00000000-0000-4000-8000-0000000d1002',
             '00000000-0000-4000-8000-0000000a0002', 'forged', now())$q$), -1);

-- 4. 改写自己的会话 id：id 是 GoTrue 的 session id，必须不可变。
--    目标 id 特意用一个**不存在的**值：换成别人已经占用的 id 会先撞唯一约束（23505），
--    那样的失败来自约束而不是策略，测不到这里想测的东西。
select probe.expect('改自己的会话 id -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$update public.user_sessions set id = '00000000-0000-4000-8000-0000000d9999'
       where id = '00000000-0000-4000-8000-0000000d0001'$q$), -1);

-- 5. 改别人的会话行：USING 不放行
select probe.expect('改别人的会话 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$update public.user_sessions set user_agent = 'hijack'
       where id = '00000000-0000-4000-8000-0000000d0002'$q$), 0);

-- 6. 把自己的行改到别人名下：with check 不放行
select probe.expect('把自己的会话改给别人 -> 拒绝', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$update public.user_sessions set user_id = '00000000-0000-4000-8000-0000000a0002'
       where id = '00000000-0000-4000-8000-0000000d1001'$q$), -1);

-- 7. 读：只看得到自己的设备
select probe.expect('读自己的设备 -> 2', probe.read(
  '00000000-0000-4000-8000-0000000a0001',
  $q$select 1 from public.user_sessions$q$), 2);

select probe.expect('读别人的设备 -> 0', probe.read(
  '00000000-0000-4000-8000-0000000a0001',
  $q$select 1 from public.user_sessions where id = '00000000-0000-4000-8000-0000000d0002'$q$), 0);

-- 8. 吊销（DELETE 策略来自 018）
select probe.expect('吊销别人的设备 -> 0 行', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$delete from public.user_sessions where id = '00000000-0000-4000-8000-0000000d0002'$q$), 0);

select probe.expect('吊销自己的设备 -> 1 行', probe.write(
  '00000000-0000-4000-8000-0000000a0001',
  $q$delete from public.user_sessions where id = '00000000-0000-4000-8000-0000000d1001'$q$), 1);

\o
select probe.verify('037 user_sessions 登记 / 刷新 / 吊销矩阵');

rollback;
