# 邮件模板设计方案

> Supabase Auth 的邮件（验证/邀请/重置密码）由 Supabase Dashboard → Authentication → Emails 配置，
> 不经过应用代码。本文档给出统一的模板设计与接线清单。

## 设计原则

1. **品牌一致**：与产品同色系（深蓝渐变 #0f172a → #1e4b4b），Logo 文本 "IndieStack"
2. **单一 CTA**：每封邮件只引导一个动作
3. **双语**：按 `profiles.language` 无法影响 Auth 邮件，采用英文为主、附中文摘要的双语布局
4. **安全提示**：底部固定"如果不是本人操作请忽略此邮件"

## 需要定制的模板（Supabase Dashboard）

| 模板 | 变量 | CTA |
|------|------|-----|
| Confirm Signup | `{{ .ConfirmationURL }}` | 确认邮箱 |
| Invite User | `{{ .InviteURL }}` | 接受邀请 |
| Magic Link | `{{ .ConfirmationURL }}` | 登录 |
| Change Email Address | `{{ .ConfirmationURL }}` | 确认新邮箱 |
| Reset Password | `{{ .RedirectTo }}` | 重置密码 |

## HTML 骨架（600px 宽，表格布局兼容客户端）

```html
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;font-family:-apple-system,'Segoe UI',sans-serif">
  <tr><td align="center" style="padding:32px 16px">
    <table width="600" style="background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center">
        <span style="color:#fff;font-size:20px;font-weight:700">IndieStack</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h2 style="margin:0 0 8px;color:#0f172a">{{ 邮件标题 }}</h2>
        <p style="color:#475569;line-height:1.6">{{ 说明文字 }}</p>
        <a href="{{ CTA_URL }}"
           style="display:inline-block;margin:24px 0;padding:12px 32px;background:#2563eb;
                  color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
          {{ CTA 文案 }}
        </a>
        <p style="color:#94a3b8;font-size:12px">
          或复制链接：<br>{{ CTA_URL }}
        </p>
      </td></tr>
      <tr><td style="padding:16px;background:#f1f5f9;text-align:center">
        <span style="color:#94a3b8;font-size:12px">
          If you didn't request this, please ignore this email. / 若非本人操作请忽略此邮件
        </span>
      </td></tr>
    </table>
  </td></tr>
</table>
```

## 接线清单

- [ ] Supabase Dashboard 逐模板粘贴上述骨架并替换变量
- [ ] SMTP：默认使用 Supabase 内置发件（限速），生产建议配置自定义 SMTP（Resend/阿里云邮件推送）
- [ ] 重定向域名白名单：Authentication → URL Configuration 加入生产/preview 域名
- [ ] 测试：分别触发注册/邀请/重置流程，检查各邮件客户端渲染（Gmail/Outlook/QQ 邮箱）

## 应用通知邮件管线（v0.4.0 已落地）

> 状态：发送通道**已接线**（Resend），入口为 `POST /api/cron/digest`
> （`src/app/api/cron/digest/route.ts`），由外部 cron 定时调用。

- 拉取：`listUnsentEmailNotifications()`（未读 + `email_sent=false` + 白名单类型，默认
  `team_invite/role_changed/payment_succeeded/security_alert`，时间正序，默认 100 条）
- 回执：`markEmailSent(id)`（发送成功后标记，避免重发）
- 用户偏好门控：发送前用 `shouldSendEmail()`（`src/lib/notification-prefs.ts`）检查
  `profiles.notification_settings`，矩阵如下（站内通知中心不受偏好影响，全量展示）：

  | 通知类型 | 偏好开关 |
  |----------|----------|
  | system / team_invite / role_changed / payment_succeeded / billing_update | emailNotifications（总开关，关则全停） |
  | deployment | productUpdates |
  | security_alert | securityAlerts |
  | （营销邮件） | marketingEmails（独立通道，不经 notifications 表） |

### Worker 接口

- `POST /api/cron/digest`，请求头 `x-cron-secret` 必须等于环境变量 `CRON_SECRET`，
  否则 401；`CRON_SECRET` 未配置时一律 401（防误开放）。
- 成功返回 `{ sent, groups }`（发送条数 / 收件人数）；队列为空返回 `{ sent: 0, groups: 0 }`。
- 任意一步抛错（拉取、Resend 调用、回执）→ 记录错误日志（logApiError）并返回 500，
  响应体只含 `Internal server error`，不泄露细节。
- 邮件正文中的站内链接取 `NEXT_PUBLIC_APP_URL`（兜底 `http://localhost:3000`），
  生产环境必须配置为 https 绝对地址，否则 CTA 链接指向错误域名。
- 发件人取 `RESEND_FROM`，兜底 `IndieStack <onboarding@indiestack.dev>`；
  `RESEND_API_KEY` 缺失时发送直接抛错（走 500 分支）。

### 调度与时区（v0.5.0 A04 错峰）

- 代码内不含固定调度，发送频率由外部 cron 决定（建议**每小时**调用一次）。
- 错峰门控：worker 只发送当前处于**本地 08:00** 的用户
  （`profiles.timezone` IANA 标识，经 `Intl.DateTimeFormat` 解析；
  为空或非法时回退 `Asia/Shanghai`/UTC+8，不让坏数据静默丢邮件）。
  因此中国用户在北京时间 08:00-09:00 之间的那次 cron 运行中收到摘要，
  其他时区用户各自错峰，单次 cron 最多处理 100 条。
- Vercel Cron 使用 UTC，按小时配置即可（如 `0 * * * *`）；自建 crontab 同理。

### 实时单发通道（v0.5.0 A03）

- 高优先级类型 `security_alert / team_invite / role_changed / payment_succeeded`
  在事件触发时即时单发，不经 cron 等待：
  - 支付成功 → Stripe webhook（`payment_succeeded`）
  - 团队邀请 → 邀请 API（`team_invite`）
  - 角色变更 → admin action（`role_changed`）
- 统一入口 `notifyUser()`（`src/lib/email-notify.ts`）：先写站内通知（失败上抛，
  由调用方吞错），再对实时类型走偏好门控 → 渲染 → Resend 发送 → 回执
  `markEmailSent`；邮件侧任何失败只记日志，**通知留在队列由 cron digest 兜底重试**
  （at-least-once）。
- 非实时类型（system/deployment/billing_update）邮件侧仍只经 digest 打包发送。

### 聚合与发送规则（实际行为）

> v0.4.0 的实现是”按用户合并为一封摘要”，没有独立的实时单发通道：
> 所有白名单类型的通知都积压到下一次 cron 统一打包发送。

- 按用户分组：同一用户的所有待发通知合并为一封邮件，
  标题 `IndieStack 通知摘要（N 条）`，单一 CTA”查看通知”指向站点首页。
- 同类型折叠（v0.5.0 A01）：同类型 ≥3 条合并为一行”N 条 ×类型”，
  其余逐条列出 title + body（HTML 转义），明细最多 5 条，
  溢出部分显示”另有 N 条通知，请登录查看”（`src/lib/email-digest.ts`）。
- 逐条偏好过滤：对该用户的每条通知跑 `shouldSendEmail()`，被开关关掉的类型
  不进入这封摘要（例如 `productUpdates=false` 时 deployment 通知被剔除，
  而不是整封跳过；`emailNotifications=false` 时整封跳过）。
- 跳过条件：用户过滤后为空、或 `profiles.email` 为空 → 该用户本次不发。

### 失败与重试

- 回执采用”发送成功后才 `markEmailSent`”的顺序，因此失败的批次天然重试：
  本次运行抛错 → 通知保持 `email_sent=false` → 下一次 cron 调用重新拉取发送
  （at-least-once 语义，极端情况下用户可能收到重复邮件）。
- 重试计数与死信（v0.5.0 A02）：单用户发送失败不再阻断整轮，
  逐条累加 `metadata.email_attempts` 并记录最近错误到 `metadata.email_error`；
  `email_attempts` 达到 `EMAIL_MAX_ATTEMPTS`（3）的通知由拉取侧 `.or` 过滤排除
  （死信），不再进入队列，避免持续失败阻塞后续批次。死信需人工排查
  `notifications.metadata.email_error`。
- 部分成功按用户隔离：循环按用户依次发送，某一用户发送失败时，
  之前用户已发送并标记完成，之后用户继续处理；响应体通过
  `{ sent, groups, failed }` 暴露本轮失败条数。
