# Webhook 幂等协议

> v0.8.x H06 建立。迁移：[`030_webhook_event_idempotency.sql`](../../supabase/migrations/030_webhook_event_idempotency.sql)，
> 实现：[`src/lib/repositories/webhook-events.ts`](../../src/lib/repositories/webhook-events.ts) +
> [`src/app/api/webhooks/stripe/route.ts`](../../src/app/api/webhooks/stripe/route.ts)。

## 为什么需要占位

Stripe 是 **at-least-once** 投递：同一 `event.id` 可能被投递多次，且任何非 2xx 响应都会触发重试。
在 H06 之前，`webhook_events` 只是一张"日志表"——处理器**先执行全部副作用**（写订阅状态、
发"付款成功"通知），最后才 `upsert` 一行。日志表只能事后掩盖症状，无法阻止副作用重复：

| 现象                             | 旧行为                             | 现行为                                    |
| -------------------------------- | ---------------------------------- | ----------------------------------------- |
| 同一事件投递两次                 | 副作用执行两次，日志仍只有一行     | 第二次直接回 200，零副作用                |
| 数据库写日志失败                 | 副作用已执行，Stripe 收到 500 重试 | 副作用执行前占位失败，回 500 但不重放     |
| 进程在副作用执行中途崩溃         | 无占位概念，重试直接重放           | `received` 租约 15 分钟后可重新占位       |
| 业务失败（订阅写入报错）         | 已写入日志，重试被判为重复         | 标记 `failed`，Stripe 重试可重新占位      |

F05 时代的"重复 event id 幂等"用例只断言日志行数，因此**无法**发现副作用重复；H06 的 E2E 改为断言
副作用本身（通知行数）在两次投递后仍为 1。

## 协议：先占位 → 再处理 → 后落状态

```
POST /api/webhooks/stripe
  ├─ 验签失败                                   → 400（不占位，Stripe 重试）
  ├─ claim_webhook_event(provider, event_id)    → 原子占位
  │    ├─ claimed   → 执行副作用
  │    └─ duplicate → 200 {received:true,duplicate:true}，不执行任何副作用
  ├─ 副作用抛错                                 → 标记 failed + 500（Stripe 重试可重新占位）
  └─ 副作用成功                                 → 标记 processed/skipped
       │  （processed = 计费状态真的写了一行；订阅事件解析不出 team_id 时一行都没写，
       │   只能算 skipped——重复投递两者都判 duplicate，所以这条区分不改变重放行为）
       └─ 落状态失败                            → 仅记日志，仍回 200
```

### 关键取舍

- **`duplicate` 回 200 而不是 409/500**：Stripe 只有收到 2xx 才停止重试。重复投递回非 2xx 会让
  Stripe 继续重放，正好等于要消灭的行为。
- **`claim_webhook_event()` 报错时抛错、不降级为 duplicate**：数据库故障被伪装成"已处理"会让
  Stripe 收到 200 后停止重试，静默丢失支付状态同步。失败封闭（fail-closed）成 500 才安全。
- **副作用成功后的落状态失败只记日志**：此时副作用**已经执行**。若因此回 500 或写 `failed`，
  Stripe 的下一次重试会重新占位并**必然重放副作用**（重复订阅写入、重复通知）。代价是
  `received` 租约（15 分钟）到期后的一次重试可能重放，这远小于必然重放。
- **`attempts` 累加而非重置**：`attempts` 是该事件的累计占位次数，是观测 Stripe 重试强度与
  定位"某个事件反复失败"的核心指标。

### 租约与状态机

`claim_webhook_event()` 是唯一的占位入口（`security definer` + 空 `search_path`，只授予
`service_role`）。判定顺序：

1. `insert ... on conflict do nothing` 成功 ⇒ `claimed`（首次投递，`attempts = 1`）。
2. 行已存在 ⇒ `select ... for update` 加行锁，串行化同一事件的并发投递。
3. `status = 'failed'` ⇒ 可重新占位，`attempts + 1`。
4. `status = 'received'` 且 `last_attempt_at` 早于 `now() - 15 minutes` ⇒ 视为进程崩溃，可重新占位。
5. 其余（`received` 未超时 / `processed` / `skipped`）⇒ `duplicate`。

并发投递同一事件时，恰好一个调用拿到 `claimed`，其余全部 `duplicate`。
`webhook_events` 的唯一约束同时从 `event_id` **收窄为 `(provider, event_id)`**，避免将来接入
第二个 provider（如 LemonSqueezy）时 event id 互相碰撞。

## 运维检查

```sql
-- 1) 幂等函数只对服务端开放（anon / authenticated 应为 f，service_role 为 t）
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'claim_webhook_event';

-- 2) 唯一键已收窄为复合键（应只看到 webhook_events_provider_event_id_key）
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.webhook_events'::regclass and contype = 'u';

-- 3) 看谁在被重试（attempts > 1）以及卡在 received 的事件
select provider, event_id, event_type, status, attempts, last_attempt_at
from public.webhook_events
where attempts > 1 or status = 'failed'
order by last_attempt_at desc
limit 50;
```

本地并发验证（8 路并发同一 `event_id`，应恰好 1 条 `claimed`）：

```sql
-- psql 会话中交替执行；期望 count(*)=1 且 attempts=1
select outcome, attempts from public.claim_webhook_event('stripe', 'evt_probe', 'customer.created');
select count(*) from public.webhook_events where provider='stripe' and event_id='evt_probe';
```

## 回滚

该迁移是**应用与数据库协同**变更，单独回滚 DDL 会让应用调用不存在的 RPC 而全线 500：

1. 先回滚应用：恢复 `webhook_events` 的"最后 upsert 日志"写入路径（即回退
   `src/app/api/webhooks/stripe/route.ts` 与 `src/lib/repositories/webhook-events.ts`）。
2. 再回滚 DDL：`drop function public.claim_webhook_event(text, text, text);`、
   `alter table public.webhook_events drop column attempts, drop column last_attempt_at;`，
   唯一约束改回 `unique (event_id)`。

回滚后**必须**接受重复投递会重放副作用这一事实；若不能接受，应保持占位协议并改为修复具体的失败分支，
而不是回滚。
