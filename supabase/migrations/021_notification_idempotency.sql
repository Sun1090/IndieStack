-- Notification idempotency: callers may safely retry event creation without duplicates.
alter table public.notifications add column if not exists idempotency_key text;
create unique index if not exists notifications_user_idempotency_idx
  on public.notifications(user_id, idempotency_key)
  where idempotency_key is not null;
