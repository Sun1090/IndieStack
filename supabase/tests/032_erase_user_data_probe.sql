-- =============================================================================
-- 032 的擦除承诺：erase_user_data 到底删了什么、保留了什么、拒绝谁
--
-- 为什么补这一份：这是隐私承诺（`messages/*/privacy.json` 说删号后 30 天内删除或匿名化）
-- 唯一真正执行擦除的地方，而它此前只在 **mock 上**被验过——`src/lib/mock/index.ts` 里
-- 有一条 JS 镜像 `eraseMockUserData`，单测与 e2e 验的是镜像。镜像与 SQL 一致是两处代码的
-- 巧合；改了 032 忘了改镜像（或反过来），测试依然全绿，而真实用户的数据留在库里。
--
-- 这里验三件事，每条都是承诺里的一句话：
--   删——`api_usage` 整体删除、`contact_messages` 按邮箱删除；
--   留住事实、切断连接——`audit_logs` 行还在，但 `user_id` 置空、`entity_id` 指向该用户时置空、
--     `metadata` 剔除 PII 键（且**只**剔除 PII 键，别把 team_id 之类的上下文一起抹了）；
--   拒绝——anon / authenticated 无权调用；null 用户 id 被函数自己拒绝。
--
-- 读数沿用三档（1/0/-1 之外，本文件多一档 -2 = 函数自身 raise，用来把「拒绝」与「内部报错」分开）。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

-- 三个用户：u1 是被擦除的，u2 是旁观者（用来证明没波及他人），u3 只用于权限用例。
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000e0001', 'victim@probe.local'),
  ('00000000-0000-4000-8000-0000000e0002', 'bystander@probe.local'),
  ('00000000-0000-4000-8000-0000000e0003', 'anon-target@probe.local');

-- u1 的 API 使用记录（含 IP，这是承诺里点名要删的东西）与 u2 的一条对照记录
insert into public.api_usage (user_id, path, method, ip_address) values
  ('00000000-0000-4000-8000-0000000e0001', '/api/projects', 'GET', '203.0.113.7'),
  ('00000000-0000-4000-8000-0000000e0001', '/api/keys', 'POST', '203.0.113.8'),
  ('00000000-0000-4000-8000-0000000e0002', '/api/projects', 'GET', '198.51.100.9');

-- 联系消息：u1 的邮箱在库里是**另一种大小写加空格**的写法（用户手输的），
-- 按邮箱匹配必须归一化，否则这条承诺就是空的。
insert into public.contact_messages (name, email, subject, message) values
  ('Victim', '  Victim@Probe.Local ', 'help', 'please delete me'),
  ('Bystander', 'bystander@probe.local', 'hi', 'keep me');

-- 审计日志：
--   a) u1 自己的动作，metadata 带 email / ip / user_agent，另有一个非 PII 的 team_id
--   b) u1 的动作，entity_id 直接指向 u1
--   c) u1 的动作，metadata 是 json 数组（历史脏数据），应整体清空而不是报错中断
--   d) u2 的动作，必须一行不动
insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata) values
  ('00000000-0000-4000-8000-0000000e0001', 'project.create', 'project', 'p-1',
   '{"email":"victim@probe.local","ip":"203.0.113.7","user_agent":"curl","team_id":"t-1"}'::jsonb),
  ('00000000-0000-4000-8000-0000000e0001', 'user.login', 'user',
   '00000000-0000-4000-8000-0000000e0001', '{"ip_address":"203.0.113.7"}'::jsonb),
  ('00000000-0000-4000-8000-0000000e0001', 'user.updated', 'user', 'p-2', '["a","b"]'::jsonb),
  ('00000000-0000-4000-8000-0000000e0002', 'project.create', 'project', 'p-9',
   '{"email":"bystander@probe.local"}'::jsonb);

-- 擦除只调一次，结果存起来再逐条断言：重复调用会把行数打成 0，那就测不到「删了几行」。
create temporary table erasure as
select public.erase_user_data('00000000-0000-4000-8000-0000000e0001') as r;

/* ---------- 删：返回的行数与表里的实际结果都要对得上 --------------------- */
select probe.expect('返回 apiUsage=2', (select (r ->> 'apiUsage')::int from erasure), 2);
select probe.expect('返回 contactMessages=1', (select (r ->> 'contactMessages')::int from erasure), 1);
select probe.expect('返回 auditLogsAnonymized=3', (select (r ->> 'auditLogsAnonymized')::int from erasure), 3);
select probe.expect(
  'api_usage 里 u1 的行已清空',
  (select count(*)::int from public.api_usage where user_id = '00000000-0000-4000-8000-0000000e0001'),
  0
);
select probe.expect(
  'api_usage 里 u2 的行没被动',
  (select count(*)::int from public.api_usage where user_id = '00000000-0000-4000-8000-0000000e0002'),
  1
);
select probe.expect(
  'contact_messages 大小写/空格不同也删掉',
  (select count(*)::int from public.contact_messages where lower(btrim(email)) = 'victim@probe.local'),
  0
);
select probe.expect(
  'contact_messages 别人的还在',
  (select count(*)::int from public.contact_messages where email = 'bystander@probe.local'),
  1
);

/* ---------- 留住事实、切断连接 ------------------------------------------ */
select probe.expect(
  'audit_logs 行还在（3 条 u1 的行没有被删）',
  (select count(*)::int from public.audit_logs where entity_id in ('p-1', 'p-2') or action = 'user.login'),
  3
);
select probe.expect(
  'audit_logs 里指向 u1 的 user_id 已置空',
  (select count(*)::int from public.audit_logs where user_id = '00000000-0000-4000-8000-0000000e0001'),
  0
);
select probe.expect(
  'entity_id 指向 u1 的那条已置空',
  (select count(*)::int from public.audit_logs where entity_id = '00000000-0000-4000-8000-0000000e0001'),
  0
);
-- 只数被擦除的那三行：u2 的行**应该**还留着 email（它是旁观者，不该被匿名化），
-- 所以这一格若不加范围就会把「别人没被动」误判成「PII 没删干净」。
select probe.expect(
  '被擦除的三行 metadata 里已无 email / ip / ip_address / user_agent',
  (select count(*)::int from public.audit_logs
     where (entity_id in ('p-1', 'p-2') or action = 'user.login')
       and metadata ?| array['email', 'ip', 'ip_address', 'user_agent']),
  0
);
select probe.expect(
  'metadata 里的非 PII 键保留（team_id 还在）',
  (select count(*)::int from public.audit_logs where metadata ->> 'team_id' = 't-1'),
  1
);
-- 两行会变成 `{}` 并且这是对的：一行是 json 数组（脏数据，整体清空），
-- 另一行是 `{"ip_address": …}`（唯一的键就是 PII，剔完自然为空）。
select probe.expect(
  '非 object 的 metadata 被清空、PII 全落的行也成空对象（共 2 行）',
  (select count(*)::int from public.audit_logs where jsonb_typeof(metadata) = 'object' and metadata = '{}'::jsonb),
  2
);
select probe.expect(
  'a 行只剩 team_id 一个键',
  (select count(*)::int from public.audit_logs where entity_id = 'p-1' and metadata ? 'team_id'
     and metadata - 'team_id' = '{}'::jsonb),
  1
);
select probe.expect(
  'u2 的审计行一行没动（user_id 与 metadata 都还在）',
  (select count(*)::int from public.audit_logs
     where user_id = '00000000-0000-4000-8000-0000000e0002'
       and metadata ->> 'email' = 'bystander@probe.local'),
  1
);

/* ---------- 权限与入参校验 ---------------------------------------------- */
-- 以某个角色调用一次擦除，-1 = 权限拒绝，-2 = 函数自己 raise，0 = 成功。
create or replace function probe.erase_as(p_role text, p_uid uuid)
returns integer
language plpgsql
as $$
begin
  perform set_config('role', p_role, true);
  begin
    perform public.erase_user_data(p_uid);
  exception
    when insufficient_privilege then
      perform set_config('role', 'postgres', true);
      return -1;
    when others then
      perform set_config('role', 'postgres', true);
      return -2;
  end;
  perform set_config('role', 'postgres', true);
  return 0;
end;
$$;

select probe.expect(
  'anon 调用 -> 拒绝',
  probe.erase_as('anon', '00000000-0000-4000-8000-0000000e0003'),
  -1
);
select probe.expect(
  'authenticated 调用 -> 拒绝',
  probe.erase_as('authenticated', '00000000-0000-4000-8000-0000000e0003'),
  -1
);
select probe.expect(
  'null 用户 id -> 函数自身拒绝（不是静默成功）',
  probe.erase_as('service_role', null),
  -2
);

\o
select probe.verify('032 erase_user_data：删 / 匿名化 / 不波及他人 / 权限');

rollback;
