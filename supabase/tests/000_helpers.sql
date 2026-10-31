-- =============================================================================
-- 探针公共夹具（由 `pnpm check:rls-probe` 按文件名顺序最先执行）
--
-- 每个探针文件都在一个事务里跑、结尾 `rollback`，互不影响；这个文件只提供三样东西：
--   1. 把 authenticated 的表权限补齐（Supabase 靠默认权限做这件事，裸 Postgres 不会）；
--   2. `probe_*` 系列函数：扮演 PostgREST（切角色 + 注入 JWT claims）并返回**可判读的读数**；
--   3. 读数的共同语义（见下）。
--
-- 全部落在 `probe` schema 里，不碰 `public`：探针夹具不该改变被测 schema 的形状
-- （`grant ... on all tables in schema public` 一旦把探针自己的表也算进去，
--  那条 grant 就同时改写了被测对象的权限面）。
--
-- 读数语义——这是整套探针的核心，三种结果必须分开看：
--   > 0   —— 语句执行成功，数字是**受影响/可见的行数**
--   0     —— RLS 的 USING 没放行：语句没报错，但一行都没碰。**这是最危险的一种**
--            （036 之前每一次 UPDATE 都是这个读数，而应用层照样返回成功）
--   -1    —— 命中 WITH CHECK / 权限不足，被数据库拒绝（SQLSTATE 42501）
--   负数与 0 都不是「成功」，但它们的含义相反：一个是「拒绝」，一个是「安静地什么都没发生」。
-- =============================================================================

create schema if not exists probe;

-- Supabase 对 anon / authenticated 都授予表权限，真正的收口在 RLS。
-- 只 grant 给 authenticated 会让「anon 越权」这类用例以 permission denied 失败，
-- 而那条失败看起来像策略生效，其实是我们自己的夹具挡住了——两者必须能分开。
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated, anon;

/** 扮演某个登录用户；`p_uid` 为 null 时扮演 anon。 */
create or replace function probe.assume(p_uid uuid)
returns void
language plpgsql
as $$
begin
  if p_uid is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text,
      true
    );
  end if;
end;
$$;

/** 回到超级用户（夹具由它写入，绕过 RLS）。 */
create or replace function probe.release()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

/** 以 `p_uid` 身份执行一条写语句，返回受影响行数；被拒绝时返回 -1。 */
create or replace function probe.write(p_uid uuid, p_sql text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform probe.assume(p_uid);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    n := -1;
  end;
  perform probe.release();
  return n;
end;
$$;

/** 以 `p_uid` 身份执行一条查询，返回**看得见**的行数。 */
create or replace function probe.read(p_uid uuid, p_sql text)
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  perform probe.assume(p_uid);
  execute format('select count(*) from (%s) t', p_sql) into n;
  perform probe.release();
  return n;
end;
$$;

create table if not exists probe.case (
  seq serial,
  case_name text,
  rows integer,
  want integer
);

/**
 * 登记一条矩阵用例。刻意做成函数而不是让每个文件各写一遍
 * `insert ... values`：那条模板抄第二遍时就会有人把「期望」抄错，
 * 而抄错的断言看起来仍然是绿的。
 */
create or replace function probe.expect(p_case text, p_rows integer, p_want integer)
returns void
language sql
as $$
  insert into probe.case (case_name, rows, want) values (p_case, p_rows, p_want);
$$;

/** 打印矩阵并断言；任何一条不符即抛异常，让 psql 以非零退出。 */
create or replace function probe.verify(p_title text)
returns void
language plpgsql
as $$
declare
  failures integer;
begin
  raise notice '';
  raise notice '%', p_title;
  raise notice '%', (
    select string_agg(
      format('  %-40s | %5s | %5s', case_name, rows, want),
      E'\n' order by seq
    )
      from probe.case
  );
  select count(*) into failures from probe.case where rows is distinct from want;
  if failures > 0 then
    raise exception '% 有 % 条不符合期望', p_title, failures;
  end if;
  raise notice '  → % 条全部符合期望', (select count(*) from probe.case);
end;
$$;

-- `probe.write` 在 authenticated 身份下还要调 `probe.release()` 把角色切回去，
-- 所以这两个角色必须能进 probe schema。少了这行，探针会以
-- 「permission denied for schema probe」失败——那看起来像被测策略的问题，其实不是。
grant usage on schema probe to authenticated, anon;
grant execute on all functions in schema probe to authenticated, anon;
