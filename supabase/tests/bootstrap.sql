-- =============================================================================
-- 本地 RLS 取证的「Supabase 面」最小替身。
--
-- **这不是生产 schema**，也不参与部署：它只在 `pnpm check:rls-probe` 起的那个
-- 一次性 Postgres 集群里跑，作用是让真实迁移（001..NNN）能在一个裸 Postgres 上
-- 应用成功，从而让策略可以被**真的执行**，而不只是被静态扫描。
--
-- 为什么值得有这一层：`check:rls` 只能读迁移文本，回答「这条策略写全了没有」；
-- 它回答不了「这条策略真的按预期收口吗」。036 那条缺陷（`team_members` 没有 UPDATE
-- 策略，于是 PostgREST 命中 0 行、`error` 为 null、action 照样 `ok()`）
-- 在静态扫描下完全不可见——因为「一行策略都没有」和「策略写错了」长得不一样。
--
-- 替身只提供迁移真正用到的那几个对象，替换口径：
--   auth.uid()    —— 从 `request.jwt.claims` 里取 `sub`，与 Supabase 同源
--   auth.role()   —— 同上取 `role`
--   auth.users    —— 只建迁移里被引用的列（id / email / raw_user_meta_data）
--   storage.*     —— buckets / objects / foldername()，其中 objects 的 RLS 是真开着的
--   roles         —— anon / authenticated / service_role（后者 BYPASSRLS）
--
-- 已知差异（写在这里，免得有人拿它当 Supabase 的等价物）：
--   - `authenticated` 的表权限是探针脚本按需 grant 的，不模拟 Supabase 的默认权限；
--   - 没有 PostgREST 那一层，探针直接执行 SQL（所以「命中 0 行」必须靠 row_count 判读，
--     而不是靠 HTTP 状态码）；
--   - `supabase_realtime` 发布是个空壳，只为让 025 迁移能过。
-- =============================================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role supabase_auth_admin nologin;

create schema if not exists extensions;
create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);

alter table storage.objects enable row level security;

-- Supabase 的 foldername 返回「目录段」，最后一段（文件名）被丢掉
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;

create publication supabase_realtime;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
