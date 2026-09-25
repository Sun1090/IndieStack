-- =============================================================================
-- A05：让「根本不可投递」的邮件通知显式离开待发队列
--
-- 背景（v0.12.0 roadmap A05 的后半）：digest worker 有两个按用户条件的跳过分支——
-- 该用户没有邮箱（`profile?.email` 为空）、以及他把所有相关类型的邮件偏好都关掉了
-- （偏好过滤后 `filtered.length === 0`）。两条都只上报 `cron.digest.skipped{reason}`
-- 就 `continue`，既不 `markEmailSent` 也不 `markEmailFailed`，所以 `metadata.email_attempts`
-- 永远不增长，永远达不到 `EMAIL_MAX_ATTEMPTS` 的死信门槛。后果不是「多发/少发」，
-- 而是**这些行永远占住队首**：`listUnsentEmailNotifications` 是 `created_at` 升序 + limit 100，
-- 攒够 100 条之后，新产生的、本来可投递的通知再也拉不到，表现为每天 `pulled=100, sent=0`。
-- 实时通道 `src/lib/notifications/email-notify.ts` 对同样两种条件也是早退，所以条目持续产生。
--
-- 本迁移给出的载体：一个可空的原因列。**非空即表示该行已经离开待发队列**，
-- 原因写的是「为什么不可能寄出去」，不是「哪一次发送失败了」——后者仍由
-- `metadata.email_attempts` / `email_error` 与死信门槛表达，两件事不得混用同一个字段。
--
-- 判定口径留在代码侧一处：原因取值常量在 `src/lib/repositories/notifications.ts`
-- 的 `EMAIL_SKIP_REASONS`，写入只发生在 digest worker 的那两个分支；
-- 本 CHECK 约束与它必须一致（不一致时写入直接被数据库拒绝，而不是静默换一种语义）。
--
-- 刻意**没有**做的两件事，都记下来免得被当成漏做：
--   1. 不加时间戳列。跳过时刻属于审计而不是队列语义，且面板要报的年龄是
--      「这条卡在队列里多久」，其权威仍是 `created_at`；加一列会让两个「年龄」同时存在。
--   2. 不加部分索引。队列过滤是 `email_sent=false && is_read=false && type in (...) && 死信条件
--      && email_skipped_reason is null`，本列只是其中第五个条件；单独为它建部分索引既不能
--      覆盖前四个条件，也不在 `docs/db/index-review.md` 的任何一条结论里。规模真到了需要索引，
--      该做的是一条覆盖整段队列谓词的索引，那是索引评审的事，不属于本条。
--
-- 幂等：`add column if not exists`，可重复执行。回滚按前向修复优先
-- （见 `docs/operations/migration-rollback-runbook.md`）：真要撤销，反向迁移是
-- `alter table public.notifications drop column email_skipped_reason`，
-- 它不丢任何投递数据——该列只记录「不再尝试」这一判定，不承载内容。
-- 注：`type` 的取值集合不在本列的约束里，故 `check:rls` / 策略层无需改动。
-- 但本列**不是防篡改的审计事实**，这一句要说准：`008_update_policy_withcheck_rest.sql:66` 的
-- "Users can mark own notifications" 只锁归属与 `user_id` 不变（`using`/`with check` 都是
-- `auth.uid() = user_id`），没有列级守卫——也就是说行主本来就能改自己通知的任意列，包括
-- `email_sent`（把自己那封邮件永久摘掉）与 `is_read`。所以本列表达的是**worker 的判定**，
-- 与那两个既有口子同性质，没有引入新的写入面；真要收紧成「只有 service_role 能写」，
-- 那是 `007_update_policy_column_guard.sql` 那一类列级守卫的工作，不属于本条。
-- =============================================================================

begin;

alter table public.notifications
  add column if not exists email_skipped_reason text
    check (email_skipped_reason in ('no_email', 'preferences_off'));

comment on column public.notifications.email_skipped_reason is
  'A05：worker 判定这条通知根本无法寄出时的原因（no_email / preferences_off）。'
  '非空即表示已离开待发队列；NULL 表示从未被跳过。与 metadata.email_attempts（发送失败重试）不同义。';

commit;
