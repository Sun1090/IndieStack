-- =============================================================================
-- 030 的幂等契约：claim_webhook_event 的六条分支
--
-- 为什么补这一份：这条函数决定「Stripe 重投时会不会重复执行副作用」，
-- 而它此前**只在 mock 上被验过**（`e2e/webhook-events.spec.ts` 跑的是
-- `src/lib/mock/index.ts` 里那条 JS 镜像）。镜像与 SQL 一致是**两处代码的巧合**，
-- 不是可核对的事实：改了 030 而忘了改 mock（或反过来）时，e2e 依然全绿。
-- 这里验的是数据库里那个真正的函数。
--
-- 读数的语义沿用同一套三档，只是「行数」换成了「占位结论」：
--   1  = claimed（这次真的获得了处理权）
--   0  = duplicate（安静地什么都不做——这正是幂等要的结果）
--   -1 = 被拒绝（42501，客户端角色无权调用）
--
-- 每条的 pre 状态（已处理 / 失败 / 租约超时）都在用例名里写明，
-- 否则读矩阵的人分不清「duplicate 是因为幂等」还是「因为状态本来就不对」。
-- =============================================================================

begin;

truncate probe.case;
\o /dev/null

-- 以某个角色调用一次 claim，返回三档读数。
-- 函数体里切角色、切回来，所以 probe.expect 永远以 postgres 身份写 probe.case。
create or replace function probe.claim_webhook(p_role text, p_event_id text)
returns integer
language plpgsql
as $$
declare
  v_outcome text;
begin
  perform set_config('role', p_role, true);
  begin
    select outcome into v_outcome
      from public.claim_webhook_event('probe', p_event_id, 'probe.event');
  exception when insufficient_privilege then
    perform set_config('role', 'postgres', true);
    return -1;
  end;
  perform set_config('role', 'postgres', true);
  return case v_outcome when 'claimed' then 1 else 0 end;
end;
$$;

/* ---------- 首次投递：占位成功 ------------------------------------------- */
select probe.expect(
  '首次投递 -> claimed',
  probe.claim_webhook('service_role', 'evt-first'),
  1
);

/* ---------- 立刻重复投递：必须是 duplicate -------------------------------- */
select probe.expect(
  '立刻重复投递 -> duplicate',
  probe.claim_webhook('service_role', 'evt-first'),
  0
);

/* ---------- 失败后重投：允许重新占位（Stripe 靠这个救回瞬时故障）--------- */
update public.webhook_events set status = 'failed', error_message = 'boom'
  where provider = 'probe' and event_id = 'evt-first';
select probe.expect(
  '上次 failed -> 重新占位',
  probe.claim_webhook('service_role', 'evt-first'),
  1
);
-- attempts 只在**占位成功**时 +1（首次 1、失败后重投 2），duplicate 不累加。
-- 这条实测读数推翻了一个想当然的读法：`attempts` 数的是「被处理过几次」，
-- 不是「Stripe 投递了几次」——所以路由日志里那句「第 N 次投递」是错的（已改成「第 N 次处理尝试」）。
select probe.expect(
  'failed 重投后 attempts 累加到 2（duplicate 不累加）',
  (select attempts from public.webhook_events where provider = 'probe' and event_id = 'evt-first'),
  2
);

/* ---------- 已成功处理且很旧：不许重放 ----------------------------------- */
insert into public.webhook_events (provider, event_id, event_type, status, attempts, last_attempt_at)
values ('probe', 'evt-done', 'probe.event', 'processed', 1, now() - interval '2 hours');
select probe.expect(
  '两小时前已 processed -> duplicate（不重放副作用）',
  probe.claim_webhook('service_role', 'evt-done'),
  0
);

/* ---------- 占位租约超时（进程崩溃）：允许下一个重投接手 ------------------ */
insert into public.webhook_events (provider, event_id, event_type, status, attempts, last_attempt_at)
values ('probe', 'evt-stale', 'probe.event', 'received', 1, now() - interval '20 minutes');
select probe.expect(
  'received 且租约超时 20 分钟 -> 重新占位',
  probe.claim_webhook('service_role', 'evt-stale'),
  1
);
select probe.expect(
  '租约接手后立刻再投 -> duplicate',
  probe.claim_webhook('service_role', 'evt-stale'),
  0
);

/* ---------- 租约未到期（还在处理中）：不能抢 ------------------------------ */
insert into public.webhook_events (provider, event_id, event_type, status, attempts, last_attempt_at)
values ('probe', 'evt-fresh', 'probe.event', 'received', 1, now() - interval '1 minute');
select probe.expect(
  'received 且租约还差 14 分钟 -> duplicate',
  probe.claim_webhook('service_role', 'evt-fresh'),
  0
);

/* ---------- 客户端角色无权调用 ------------------------------------------- */
select probe.expect(
  'anon 调用 -> 拒绝',
  probe.claim_webhook('anon', 'evt-anon'),
  -1
);
select probe.expect(
  'authenticated 调用 -> 拒绝',
  probe.claim_webhook('authenticated', 'evt-authd'),
  -1
);

\o
select probe.verify('030 claim_webhook_event：占位 / 幂等 / 失败重试 / 租约接手 / 权限');

rollback;
