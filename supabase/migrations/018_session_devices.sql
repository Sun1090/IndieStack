-- =============================================================================
-- 018: 会话设备管理（v0.5.0 D02）
-- user_sessions.id 复用为 GoTrue 会话 id（JWT payload 的 session_id claim），
-- upsert 按 id 去重实现"每设备一行 + last_seen 刷新"；
-- 新增 DELETE 策略支持单设备吊销。
-- =============================================================================

alter table public.user_sessions
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists idx_user_sessions_last_seen
  on public.user_sessions (user_id, last_seen_at desc);

create policy "users_delete_own_sessions"
  on public.user_sessions for delete
  using (auth.uid() = user_id);
