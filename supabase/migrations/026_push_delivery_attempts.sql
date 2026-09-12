-- =============================================================================
-- 026: Web Push 持久化投递尝试 / 重试队列 / 死信（v0.8.0）
-- 每个 (notification_id, endpoint) 一行，记录单次端点的投递结果，
-- 支撑退避重试、重试上限（死信）与失效端点统计；
-- 语义与邮件 metadata.email_attempts 对齐（上限 3 次）。
-- 无用户可读维度：service_role 绕过 RLS；不对 anon/authenticated 开放任何策略。
-- =============================================================================

create table if not exists public.push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 订阅被撤销后置空，保留 endpoint 以便统计与死信排查
  push_subscription_id uuid references public.push_subscriptions(id) on delete set null,
  endpoint text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  -- 机器可读的失败原因：subscription-gone / subscription-missing /
  -- notification-missing / max-attempts / http-* / timeout / network
  failure_code text,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 同一通知对同一端点只保留一行，重复入队为幂等 no-op
  unique (notification_id, endpoint)
);

-- 到期队列：worker 按 (status, next_attempt_at) 拉取待重试行
create index if not exists idx_push_delivery_attempts_due
  on public.push_delivery_attempts (status, next_attempt_at);

-- 死信 / 失效端点统计：按状态与创建时间排序
create index if not exists idx_push_delivery_attempts_status_created
  on public.push_delivery_attempts (status, created_at);

-- 单条通知的投递回执查询
create index if not exists idx_push_delivery_attempts_notification
  on public.push_delivery_attempts (notification_id);

alter table public.push_delivery_attempts enable row level security;

create trigger push_delivery_attempts_updated_at before update on public.push_delivery_attempts
  for each row execute function public.handle_updated_at();
