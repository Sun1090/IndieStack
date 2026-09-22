# 邮件投递

IndieStack 的应用邮件通过 Resend 发送；Supabase Auth 邮件由 Supabase 项目独立配置。账号邮件与
产品通知因此有不同的运维边界。

## 配置

| 变量 | 必需性 | 用途 |
| --- | --- | --- |
| `RESEND_API_KEY` | 应用邮件必需 | Resend API Key，仅服务端使用 |
| `RESEND_FROM` | 建议配置 | 已验证发件人，例如 `IndieStack <hello@example.com>` |
| `RESEND_API_URL` | 可选 | 仅测试环境覆盖端点，E2E 用它捕获请求 |
| `CRON_SECRET` | digest 必需 | 通过 `x-cron-secret` 请求头校验 `POST /api/cron/digest` |

```bash
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM="IndieStack <hello@example.com>"
CRON_SECRET=replace-with-a-random-secret
```

禁止给 `RESEND_API_KEY` 或 `CRON_SECRET` 添加 `NEXT_PUBLIC_` 前缀。

## 通知邮件

`notifyUser()` 写入站内通知后，只有以下高优先级类型会立即尝试单发邮件：

- `security_alert`
- `team_invite`
- `role_changed`
- `payment_succeeded`

实时发送同样受 `shouldSendEmail()` 控制。发送成功会写入已发送回执；发送失败则保留在队列中，
等待 digest worker 重试。其他类型的通知在当前实现中仅站内展示。

队列条件是 `email_sent = false` **且** `is_read = false`，所以在站内把一条通知读过——单条读过或
点「全部已读」——也会把它移出邮件队列：用户已经看到的东西不会再寄一封，而这一行也不再计入
`email.backlog`。「信已经发出去、但回执写入失败」是单独上报的一类，不会混进「发送失败」：
邮件确实走了，下一轮 digest 有可能再寄一次。

## Digest Worker

`POST /api/cron/digest` 每轮最多拉取 100 条待发通知，按用户分组并按该用户的邮件偏好过滤，
每人发一封摘要。实时发送失败和尚未发送的通知都由该 worker 继续处理。

Worker 会折叠大量同类型通知并限制正文明细数量，避免邮件随队列无限膨胀。运维指标除积压量与运行
记录外，还有 `cron.digest.skipped{reason}`——本轮投递不了时按用户上报被跳过的条数
（`no_email` = 该用户资料没有邮箱，`preference` = 该用户关掉了涉及的类型）。「跳过」不允许静默：
worker 路由里带条件的跳过分支若没有对应计数，`pnpm check:cron-contract` 会直接失败。

回执写入与投递在相反的方向上也是分开的：一个分组在 provider 收下信的那一刻就记为已发送，其后回执
写失败只单独上报（`cron.digest.receipt_failed{stage="sent"}`），不会打断整轮——那一行仍留在队列里，
所以下一轮可能给同一用户再寄一封摘要。镜像情形（`stage="retry"`）是「发送失败」**并且**失败回执要累加的
`email_attempts` 也没写进去：这一组仍记为 failed，但重试计数没有前进，而邮件侧没有任何东西为它兜底——
与 Web Push 不同，这里没有行龄上界，因为「N 天后丢掉队列里的邮件」改变的是送达语义，属于下面 A05
的待决内容。两种情形都不再允许抹掉本轮自己的记录：中途失败的运行会照实记下当时的 `pulled` / `sent` /
`groups` / `failed`，因为面板上「空发轮」的读数定义是 `pulled > 0 && sent === 0 && failed === 0`，
已经寄出过信的轮次绝不能出现在那里。

管理后台概览页展示的是队列本身：还有多少条待发、最老一条已经等了多久（超过 48 小时＝两个日调度
周期，读数就是「已卡住」）、以及最近有几轮拉到条目却一封没发。三个读数走的都是 worker 拉取时那段
过滤，所以面板上报的年龄说的就是那支队伍。这一条只提供可见性：因 `no_email` 或 `preference` 被跳过
的条目仍然出不了队列，它们**应当**以什么语义出队是待决的产品决策（v0.12.0 A05）。

摘要的投递语义是**每轮每人一封，只要队列里有待发内容**。它刻意不再追求「贴着用户本地早晨发送」：
Hobby plan 下每个 cron 路径每天最多运行一次，一个固定的 UTC 时刻（`0 9 * * *`）只可能落在某一个时区
的早晨——2026-09-22 之前这条路由要求「用户本地小时恰好等于 8」，结果 UTC-1 时区带之外的通知会永远
停在队列里。调度登记在 `vercel.json`，注册表、平台调度与 `docs/operations/sentry-alerts.md` 三者的
一致性由 `pnpm check:cron-contract` 守住。

如果将来确实需要按本地早晨投递，那要再加一条 cron 路径（或外部逐小时调度器），而不是放宽这个门控；
该权衡记录在 `docs/roadmap-0.12.0.md` 里。

## 偏好与重试

邮件偏好矩阵同时作用于实时单发和 digest。全局 `emailNotifications` 开关会关闭产品邮件；
`securityAlerts` 和 `productUpdates` 提供按类型控制。

每次发送失败都会累加 `metadata.email_attempts` 并记录 `metadata.email_error`。达到 3 次后，该通知
进入死信，不再被 digest 拉取；运维可通过通知 repository API 查询死信。

## 营销邮件

营销邮件是独立的 double opt-in 通道，不使用 `notifications` 表：

- 确认和退订操作只接受 `POST`。
- Token 以 SHA-256 摘要存储，7 天后失效。
- 每封营销邮件都附带当前收件人的专属退订链接。

## Supabase Auth 邮件

注册确认、邀请、Magic Link 和重置密码由 Supabase Auth 发送，不经过 Resend。模板与重定向白名单
通过以下命令管理：

```bash
pnpm auth:email-config
pnpm auth:email-config -- --apply
pnpm auth:email-config -- --verify --scope=templates
```

命令默认只做 dry-run。当前免费版使用 Supabase 默认发件人，全项目每小时只能发送 2 封 Auth
邮件。生产注册量增长前或需要修改模板前，必须先配置自定义 SMTP。

## 验证

```bash
pnpm test -- src/lib/email-send.test.ts src/lib/email-notify.test.ts
pnpm test -- src/app/api/cron/digest/route.test.ts
pnpm test:e2e -- e2e/mail-flow.spec.ts
pnpm auth:email-config
```
