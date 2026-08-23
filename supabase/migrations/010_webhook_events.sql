-- =============================================================================
-- 010: Webhook 事件日志表
-- 目的：记录 Stripe webhook 处理历史，支持 #88 Webhook 日志页与对账排障
-- 注意：应用迁移后需在 Stripe webhook 处理器中插入事件记录（接线任务）
-- =============================================================================

-- 事件日志表
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  event_id text not null unique,          -- Stripe 事件 ID（天然幂等键）
  event_type text not null,
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'skipped')),
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 启用 RLS：仅 service_role 可读写（webhook 走 admin 客户端），普通用户不可见
alter table public.webhook_events enable row level security;

-- 无需创建任何 policy：RLS 开启且无策略 = 拒绝所有普通访问，
-- service_role 绕过 RLS，满足"仅后台可见"的需求。

-- 索引：按时间倒序浏览 + 按类型筛选
create index if not exists idx_webhook_events_created_at
  on public.webhook_events (created_at desc);
create index if not exists idx_webhook_events_event_type
  on public.webhook_events (event_type);

-- 数据保留：90 天前的记录由定时任务清理（可在 Supabase Dashboard 配置 pg_cron）
-- select cron.schedule('cleanup-webhook-events', '0 3 * * *',
--   $$delete from public.webhook_events where created_at < now() - interval '90 days'$$);
