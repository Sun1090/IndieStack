-- =============================================================================
-- 016: 营销邮件订阅（double opt-in，v0.5.0 A05）
-- 独立通道：不经过 notifications 表。状态机：
--   pending（待确认，开关打开时创建）→ subscribed（点击确认链接）
--   pending/subscribed → unsubscribed（点击退订链接或关闭开关）
-- token 用于确认/退订链接（公开路由凭 token 操作，需不可猜测）。
-- 每用户一行（user_id 唯一），重复开关复用同一行并刷新 token。
-- =============================================================================

create table if not exists public.marketing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  status text not null default 'pending',
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketing_subscriptions_status_check'
  ) then
    alter table public.marketing_subscriptions
      add constraint marketing_subscriptions_status_check
      check (status in ('pending', 'subscribed', 'unsubscribed'));
  end if;
end
$do$;

create index if not exists idx_marketing_subscriptions_status
  on public.marketing_subscriptions (status);

alter table public.marketing_subscriptions enable row level security;

create policy "users_select_own"
  on public.marketing_subscriptions for select
  using (auth.uid() = user_id);

create policy "users_insert_own"
  on public.marketing_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "users_update_own"
  on public.marketing_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
