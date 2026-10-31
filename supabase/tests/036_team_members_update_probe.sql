-- =============================================================================
-- 036 的越权矩阵探针（本地 Postgres 即可跑，不需要 Supabase 栈）
--
-- 用法（先按 bootstrap → 001..036 建库）：
--   psql -h /tmp -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 \
--        -f supabase/tests/036_team_members_update_probe.sql
--
-- 判读：每个 case 一行，`rows` 是实际受影响行数，`want` 是期望。
--   rows = 0  —— RLS 的 USING 没放行（安静地什么都没改）
--   rows = -1 —— 命中 WITH CHECK，被拒绝（42501 insufficient_privilege）
--   两者都不等于「成功」；只有切到业务的合法用例才应该是 1 行。
-- 约束：整个探针在事务里跑，结尾 rollback，不污染库；可重复执行。
-- =============================================================================

\set ON_ERROR_STOP on
set client_min_messages = warning;

begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function pg_temp.probe_update(p_uid uuid, p_sql text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  -- 扮演 PostgREST：先切到 authenticated，再注入 JWT claims
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := -1;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return n;
end;
$$;

-- 夹具：两个团队、owner / admin / member / 外部人
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
  -- T1
  ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a001', 'owner'),
  ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a002', 'admin'),
  ('00000000-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000b001',
   '00000000-0000-4000-8000-00000000a003', 'member'),
  -- T2：outsider 是 owner，admin 在这里没有任何身份
  ('00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000b002',
   '00000000-0000-4000-8000-00000000a004', 'owner');

create temp table probe_result (
  seq serial, case_name text, rows integer, want integer
) on commit drop;

-- ---------------------------------------------------------------------------
-- 矩阵
-- ---------------------------------------------------------------------------
-- 顺序有意义：会改动夹具角色的用例（降级 admin）必须排在最后，
-- 否则后续「以 admin 身份」的用例会因为自己已经不是 admin 而变成 0 行，
-- 看起来仍然「安全」，其实是断言打偏了。
insert into probe_result (case_name, rows, want) values
  -- 1. 普通成员改自己的角色：USING 不放行（不是 admin）
  ('member 改自己 -> 0 行', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a003',
    $q$update public.team_members set role = 'admin'
         where id = '00000000-0000-4000-8000-00000000c003'$q$), 0);

-- 2. 合法用例：admin 把普通成员提成 admin
insert into probe_result (case_name, rows, want) values
  ('admin 改 member -> 1 行', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a002',
    $q$update public.team_members set role = 'admin'
         where id = '00000000-0000-4000-8000-00000000c003'$q$), 1);

-- 3. 提权：admin 把自己改成 owner（check 约束放行 'owner'，只有策略能挡）
insert into probe_result (case_name, rows, want) values
  ('admin 自提 owner -> 拒绝', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a002',
    $q$update public.team_members set role = 'owner'
         where id = '00000000-0000-4000-8000-00000000c002'$q$), -1);

-- 4. owner 行不可被改：admin 想把 owner 降成 member
insert into probe_result (case_name, rows, want) values
  ('admin 降级 owner -> 0 行', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a002',
    $q$update public.team_members set role = 'member'
         where id = '00000000-0000-4000-8000-00000000c001'$q$), 0);

-- 5. 顶替：admin 把成员行改成别人（改归属列）
insert into probe_result (case_name, rows, want) values
  ('admin 改 user_id -> 拒绝', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a002',
    $q$update public.team_members set user_id = '00000000-0000-4000-8000-00000000a004'
         where id = '00000000-0000-4000-8000-00000000c003'$q$), -1);

-- 6. 跨租户搬运：admin 把成员行搬到 T2
insert into probe_result (case_name, rows, want) values
  ('admin 改 team_id -> 拒绝', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a002',
    $q$update public.team_members set team_id = '00000000-0000-4000-8000-00000000b002'
         where id = '00000000-0000-4000-8000-00000000c003'$q$), -1);

-- 7. 外部人：两条团队都不是他的
insert into probe_result (case_name, rows, want) values
  ('outsider 改任意 -> 0 行', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a004',
    $q$update public.team_members set role = 'admin'
         where id = '00000000-0000-4000-8000-00000000c003'$q$), 0);

-- 8. 合法用例（放在最后：它把夹具里的 admin 降成 member）
insert into probe_result (case_name, rows, want) values
  ('owner 降 admin -> 1 行', pg_temp.probe_update(
    '00000000-0000-4000-8000-00000000a001',
    $q$update public.team_members set role = 'member'
         where id = '00000000-0000-4000-8000-00000000c002'$q$), 1);

\echo ''
\echo ' case                              | rows | want'
\echo '-----------------------------------+------+-----'
select rpad(case_name, 33) || ' | ' || rpad(rows::text, 4) || ' | ' || want
  from probe_result order by seq;

select count(*) as failing_cases from probe_result where rows is distinct from want;

do $$
declare n integer;
begin
  select count(*) into n from probe_result where rows is distinct from want;
  if n > 0 then
    raise exception '036 越权矩阵有 % 条不符合期望', n;
  end if;
  raise notice '036 越权矩阵 8/8 符合期望';
end $$;

rollback;
