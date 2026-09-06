-- Web Push subscriptions: one endpoint per user, safe to retry registration.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
create policy "Users manage own push subscriptions" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create trigger push_subscriptions_updated_at before update on public.push_subscriptions
  for each row execute function public.handle_updated_at();
