# Web Push

IndieStack 通过 Web Push 协议发送浏览器通知。订阅关系持久化在 Supabase，服务端投递使用
`web-push` 适配器与 VAPID 凭证。

## 配置

| 变量                           | 必需性   | 用途                                         |
| ------------------------------ | -------- | -------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | 必需     | 浏览器使用的 VAPID 公钥                      |
| `VAPID_PRIVATE_KEY`            | 必需     | 服务端签名私钥，禁止添加 `NEXT_PUBLIC_` 前缀 |
| `NEXT_PUBLIC_APP_URL`          | 建议配置 | VAPID 联系主体；生产环境必须使用 HTTPS       |

生成一组密钥并写入部署环境：

```bash
pnpm exec web-push generate-vapid-keys

NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
NEXT_PUBLIC_APP_URL=https://app.example.com
```

当 `NEXT_PUBLIC_APP_URL` 不是 HTTPS 时，适配器使用 `mailto:support@indiestack.dev` 作为 VAPID
主体。公钥或私钥缺失会明确关闭 provider；设置页会显示“未配置”，不会伪装成发送成功。

生产环境必须使用 HTTPS，因为除 localhost 开发环境外，浏览器只在安全上下文中提供 Service Worker
和 PushManager。

## 订阅流程

1. 用户在 `/dashboard/settings` 开启**浏览器通知**。
2. 浏览器注册 `/sw.js` 并创建 Push API 订阅。
3. endpoint、`p256dh` 和 `auth` 写入 `public.push_subscriptions`。
4. `user_id + endpoint` 唯一，因此重复注册是幂等的。
5. 关闭通知时同时删除数据库记录和浏览器订阅。
6. 页面重新加载后，设置表单会识别已有浏览器订阅。

迁移 `020_push_subscriptions.sql` 创建数据表、RLS 策略、endpoint 索引和 `updated_at` 触发器。

迁移 `026_push_delivery_attempts.sql` 新增按 endpoint 记录的持久化重试与死信表。该表仅服务端
使用：启用 RLS 且不对 anon/authenticated 开放策略，cron worker 通过 service-role 客户端访问。

## 投递契约

`notifyUser()` 先写入站内通知，再向该用户的每个有效订阅尝试 Web Push。Service Worker 接收的
JSON payload 为：

```json
{
  "title": "安全告警",
  "body": "请检查你的登录会话",
  "url": "/dashboard/settings",
  "tag": "event-idempotency-key"
}
```

投递使用 1 小时 TTL、10 秒传输超时、high urgency 和 VAPID 鉴权，并会扇出到用户的全部订阅。

每个 `(notification_id, endpoint)` 在首次传输调用前先落库。站内通知仍是可靠事实来源；Web Push
本身是至少一次投递，成功回执丢失时可能重复推送，Service Worker 的 `tag` 会在浏览器支持时保持
通知展示幂等。

Push 与邮件共用类型偏好矩阵，同时额外受 `pushNotifications` 控制。设置
`pushNotifications: false` 会关闭所有浏览器推送，但不影响站内通知。

## 重试与死信队列

- 瞬时失败保持 `pending`，按指数退避重试（`60s × 2^(n-1)`，上限 1 小时）。当前最多尝试 3 次，
  因此实际等待为首次失败后 60 秒、随后 2 分钟。
- 每条投递最多尝试 3 次（含即时投递）。第 3 次仍失败时写入 `dead`，`failure_code=max-attempts`，
  worker 不再拉取。
- 行龄是第二道、也是绝对的上界：入队 7 天（`PUSH_RETRY_MAX_AGE_MS`）后仍是 `pending` 的行直接写入
  `dead`，`failure_code=max-age`。两道界都留着的原因是：`attempt_count` 只有在重排回执写成功时才会
  前进，如果那次写入持续失败，这一行的计数会冻结在队首被无限重试。而 `created_at` 是写失败也拖不住
  的那条界。
- 每轮最多处理 50 条到期记录。`/api/cron/push-retry` 在 `vercel.json` 中以 `0 22 * * *` 调度，
  每天 22:00 UTC 一次；Vercel Hobby 每个路径每天最多一次，与 `/api/cron/digest` 一样要求 `CRON_SECRET`。
- 订阅记录已删除、用户期间关闭 Push，或通知记录不存在时，不再调用推送服务，直接进入死信队列。
- 死信保留供运维排查，可通过 `src/lib/repositories/push-delivery-attempts.ts` 的
  `listDeadLetterPushDeliveries()`、`countDeadLetterPushDeliveries()` 和
  `countInvalidPushEndpoints()` 查询。
- 终态行按保留期自动清理：`sent` 保留 7 天，`dead` 保留 30 天，每轮 cron 每个状态最多删除 1000 行；
  `pending` 永不清理，因此不会丢失延迟任务。路由以 `pruned: { sent, dead }` 返回删除计数；清理是
  best-effort，失败时返回 `pruned: null`，不影响本轮投递结果。

## 失败与清理

- HTTP `404` 或 `410` 表示浏览器 endpoint 已永久失效，系统立即删除该订阅并写入
  `subscription-gone` 死信。
- 其他瞬时失败会记录日志并进入重试队列，不影响站内通知或邮件通道。
- 指标：`push.send.completed` 带 `status_code`；`push.send.failed` 带 `not-configured`、
  `subscription-gone`、`timeout`、`http-*` 等原因。`push.endpoint.revoked` 与
  `push.delivery.dead` 按原因统计订阅撤销和死信，`push.backlog` 上报待重试积压，
  `push.queue.pruned` 按 `status` / `retention_days` 统计终态清理，`push.queue.prune_failed`
  上报清理失败，`push.delivery.retry_failed` 标记「投递失败而重排回执也没写进去」（退避与计数都没推进），
  `cron.push-retry.completed` / `cron.push-retry.failed` 监控 worker 健康。

## 验证

```bash
pnpm test -- src/lib/push-provider.test.ts src/lib/push-notify.test.ts
pnpm test -- src/lib/push-retry.test.ts src/lib/repositories/push-delivery-attempts.test.ts
pnpm test -- src/lib/repositories/push-subscriptions.test.ts src/lib/email-notify.test.ts
pnpm test -- src/components/forms/push-notification-form.test.tsx
pnpm type-check
```

真实浏览器 Push 还需要 VAPID 凭证、HTTPS、支持 Push 的浏览器和推送服务，因此端到端路径属于部署
环境检查，不由本地单测替代。
