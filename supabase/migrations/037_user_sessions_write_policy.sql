-- =============================================================================
-- 补 user_sessions 的 INSERT / UPDATE 策略（适用于已应用 001-036 的数据库）
--
-- 缺陷：018 的注释写着「user_sessions.id 复用为 GoTrue 会话 id，upsert 按 id 去重
-- 实现『每设备一行 + last_seen 刷新』」，但它只补了 DELETE 策略。
-- 而唯一的写入方 `recordCurrentSession()`（`src/lib/actions/sessions.ts`）用的是
-- **用户作用域客户端**去 upsert：
--
--     supabase.from("user_sessions").upsert({ id: sessionId, user_id: user.id, ... },
--                                           { onConflict: "id" })
--
-- RLS 下 INSERT 没有策略 = 拒绝（**不是** 0 行，是 42501），于是这一次写入**每次都失败**：
--   - 登录回调里被 try/catch 吞掉，只留一行服务端日志；
--   - dashboard 的心跳是 `void recordCurrentSession()`，失败天然静默；
--   - 设置页的「已登录设备」读的是这张表 ⇒ **永远是空的**（除 seed 数据）；
--   - `revokeSession()` 只能对着不存在的行工作 ⇒ 永远答 `sessionNotFound`。
--
-- 也就是说「设备管理」这个功能在真库上从未工作过。它之所以一直看起来正常，
-- 是因为 e2e / 单测全跑在 mock 上，而 **mock 没有 RLS**——与 009 那条迁移
-- （team_members 策略自引用递归，同样只在真库暴露）是同一类问题。
-- 实测读数见 `supabase/tests/037_user_sessions_probe.sql`：修之前 authenticated 的
-- INSERT 读数是 `-1`（42501），SELECT 是正常行数。
--
-- 策略口径（与「每设备一行、只登记自己」这个用途一致，不多不少）：
--   INSERT —— `with check (auth.uid() = user_id)`：只能给自己登记。
--   UPDATE —— `using (auth.uid() = user_id)`（只能刷新自己的行）
--             `with check (auth.uid() = user_id and id = get_user_session_id(id))`：
--               user_id 不可改成别人；**id 也不可改**——它是 GoTrue 的 session id，
--               允许改等于允许「抢占别人的会话 id」，会让对方下一次 upsert 撞上冲突。
--               `using` 里的 id 是旧值，所以这个比较就是「id 必须与旧值相同」；
--               幂等：create or replace / drop policy if exists。
--
-- 为什么 UPDATE 需要单独一条而不能只靠 INSERT 的 with check：
--   `upsert ... on conflict do update` 在 PostgreSQL 里走的是
--   `INSERT ... ON CONFLICT DO UPDATE`，冲突分支受 **UPDATE 策略**约束。
--   只补 INSERT 策略时，第一次登记会成功、第二次（刷新 last_seen_at）会被拒——
--   一个「第一次能用、之后全坏」的形状，比全坏更难查。
-- =============================================================================

begin;

create or replace function public.get_user_session_id(p_id uuid)
returns uuid
language sql
security definer set search_path = ''
as $$ select id from public.user_sessions where id = p_id $$;

drop policy if exists "Users can register own sessions" on public.user_sessions;

create policy "Users can register own sessions"
  on public.user_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can refresh own sessions" on public.user_sessions;

create policy "Users can refresh own sessions"
  on public.user_sessions for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and id = public.get_user_session_id(id)
  );

commit;
