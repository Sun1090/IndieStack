-- =============================================================================
-- A05 后半：让「跨天趋势」真的拿得到每天的历史读数
--
-- 背景（v0.12.0 roadmap A05 收尾后发现的缺陷）：admin 面板的「队列趋势」卡要把
-- 每天的 digest 轮次喂给 `judgeDigestSeries`，而那个判定看的是**积压是否在降、
-- 跳过是否在涨**（`first.backlog → last.backlog`、`first.skipped → last.skipped`）。
-- 但 `email_worker_runs` 只记了 `pulled/sent/groups/failed`，**没记每轮的 backlog 与 skipped**。
-- 于是面板只能拿「当前这一次 `countUnsentEmailNotifications()` 的读数」去填序列里
-- **每一天**——所有天的 backlog 相同、skipped 相同，`backlogFalling` 与 `skippedRising`
-- **永远为 false**，A05_DRAINING / BACKLOG_NOT_DRAINING 这两条跨天分支**结构上永不触发**。
-- 后果不是「看不见趋势」，而是**对「跳过在涨但积压不降」这个 A05 专门要抓的形态，
-- 面板给出一句假的「一切正常」**——比没有这张卡更糟，因为它长得像被检查过。
--
-- 本迁移补的就是这两列。**可空，且刻意不给 default 0**：
-- NULL 表示「这一轮没有记录到该读数」，与「记录了、值是 0」是两种语义。
-- 崩在 `countUnsentEmailNotifications()` 之前的失败轮次拿不到 backlog，
-- 就该留 NULL，而不是被 0 冒充成「空队列时崩的」——
-- `judgeDigestSeries` 会把带 NULL 的轮次连同日期一起排除在趋势之外（宁可判「数据不足」，
-- 也不拿一个不存在的 0 去算「积压在降」），这与本仓库反复用到的「未知不算通过」是同一条。
--
-- 取值口径（写侧唯一出处 `src/app/api/cron/digest/route.ts`）：
--   - backlog  = 本轮开始时 `countUnsentEmailNotifications()` 的结果，与 `email.backlog` 指标同源；
--   - skipped  = 本轮按用户条件跳过的条数，与 `cron.digest.skipped{reason}` 指标的合计同源。
-- 二者都是「本轮观测」，不是队列里历史累计——`skipped` 尤其不要与 notifications 表上
-- `email_skipped_reason is not null` 的累计行数混为一谈（那是存量，这是本轮增量）。
--
-- 幂等：`add column if not exists`，可重复执行。回滚按前向修复优先
-- （见 `docs/operations/migration-rollback-runbook.md`）：真要撤销，反向迁移是
-- `alter table public.email_worker_runs drop column if exists backlog, drop column if exists skipped;`
-- ——这两列只承载观测读数，不承载投递语义，删列不丢任何投递数据。
-- =============================================================================

begin;

alter table public.email_worker_runs
  add column if not exists backlog integer,
  add column if not exists skipped integer;

comment on column public.email_worker_runs.backlog is
  'A05：本轮 worker 开始时待发队列的条数（email.backlog 同源）。'
  'NULL=本轮未记录到（如崩在取数前），区别于 0=取数成功且队列为空。';

comment on column public.email_worker_runs.skipped is
  'A05：本轮按用户条件跳过的条数（cron.digest.skipped{reason} 合计同源）。'
  '是本轮增量，非 notifications 上 email_skipped_reason 的存量。NULL=本轮未记录到。';

commit;
