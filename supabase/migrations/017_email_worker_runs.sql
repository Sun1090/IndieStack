-- =============================================================================
-- 017: 邮件 worker 运行记录（v0.5.0 C02）
-- 每次 /api/cron/digest 执行落一行（含拉取/发送/失败计数与耗时），
-- 供 admin 看板与积压排查；无用户维度，仅受信服务端读写。
-- =============================================================================

create table if not exists public.email_worker_runs (
  id uuid primary key default gen_random_uuid(),
  pulled integer not null default 0,
  sent integer not null default 0,
  groups integer not null default 0,
  failed integer not null default 0,
  duration_ms integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_worker_runs_created
  on public.email_worker_runs (created_at desc);

alter table public.email_worker_runs enable row level security;

-- 无用户维度：service_role 绕过 RLS 读写；不对 anon/authenticated 开放任何策略
