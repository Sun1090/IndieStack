# 邮件模板设计方案

> Supabase Auth 的邮件（验证/邀请/重置密码）由 Supabase Dashboard → Authentication → Emails 配置，
> 不经过应用代码。本文档给出统一的模板设计与接线清单。

## 设计原则

1. **品牌一致**：与产品同色系（深蓝渐变 #0f172a → #1e4b4b），Logo 文本 "IndieStack"
2. **单一 CTA**：每封邮件只引导一个动作
3. **双语**：按 `profiles.language` 无法影响 Auth 邮件，采用英文为主、附中文摘要的双语布局
4. **安全提示**：底部固定"如果不是本人操作请忽略此邮件"

## 需要定制的模板（Supabase Dashboard）

| 模板                 | 变量                     | CTA        |
| -------------------- | ------------------------ | ---------- |
| Confirm Signup       | `{{ .ConfirmationURL }}` | 确认邮箱   |
| Invite User          | `{{ .InviteURL }}`       | 接受邀请   |
| Magic Link           | `{{ .ConfirmationURL }}` | 登录       |
| Change Email Address | `{{ .ConfirmationURL }}` | 确认新邮箱 |
| Reset Password       | `{{ .RedirectTo }}`      | 重置密码   |

## HTML 骨架（600px 宽，表格布局兼容客户端）

```html
<table
  width="100%"
  cellpadding="0"
  cellspacing="0"
  style="background:#f8fafc;font-family:-apple-system,'Segoe UI',sans-serif"
>
  <tr>
    <td align="center" style="padding:32px 16px">
      <table width="600" style="background:#ffffff;border-radius:12px;overflow:hidden">
        <tr>
          <td
            style="background:linear-gradient(135deg,#0f172a,#1e1b4b);padding:24px;text-align:center"
          >
            <span style="color:#fff;font-size:20px;font-weight:700">IndieStack</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <h2 style="margin:0 0 8px;color:#0f172a">{{ 邮件标题 }}</h2>
            <p style="color:#475569;line-height:1.6">{{ 说明文字 }}</p>
            <a
              href="{{ CTA_URL }}"
              style="display:inline-block;margin:24px 0;padding:12px 32px;background:#2563eb;
                  color:#fff;border-radius:8px;text-decoration:none;font-weight:600"
            >
              {{ CTA 文案 }}
            </a>
            <p style="color:#94a3b8;font-size:12px">或复制链接：<br />{{ CTA_URL }}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px;background:#f1f5f9;text-align:center">
            <span style="color:#94a3b8;font-size:12px">
              If you didn't request this, please ignore this email. / 若非本人操作请忽略此邮件
            </span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

## 接线清单

- [ ] Supabase Dashboard 逐模板粘贴上述骨架并替换变量
      → 骨架已固化成代码（见下方「自动化接线」），但**生产项目当前无法写入**：Supabase 免费版 +
      默认发件人会拒绝
      `Email template modification is not available for free tier projects using the default email provider.`。
      先配置自定义 SMTP（下一项）或升级套餐，再执行 `pnpm auth:email-config -- --apply --scope=templates`。
- [ ] SMTP：默认使用 Supabase 内置发件（限速），生产建议配置自定义 SMTP（Resend/阿里云邮件推送）
      → 2026-09-12 线上读取结果：`smtp_host = null`、`rate_limit_email_sent = 2`，即内置发件对
      整个项目每小时最多发 2 封 Auth 邮件（注册确认 / 邀请 / 魔法链接 / 重置都共用这一额度）。
      这既是模板自定义的前置条件，也是注册量增长后的第一个硬瓶颈。
- [x] 重定向域名白名单：Authentication → URL Configuration 加入生产/preview 域名
      → 2026-09-12 已应用到生产项目 `ntqggnztzvoavjbiillb` 并回读校验通过：
      `http://localhost:3000/**,https://indie-stack-theta.vercel.app/**,https://*-sun1090s-projects.vercel.app/**,https://indie-stack-*.vercel.app/**`。
      `.github/workflows/security-config.yml` 每次 push/PR/周计划都会跑漂移门禁。
- [ ] 测试：分别触发注册/邀请/重置流程，检查各邮件客户端渲染（Gmail/Outlook/QQ 邮箱）
      → 需要可收信邮箱与已启用的模板，模板应用前保持未验证；模板写入后再用真实收件箱逐客户端检查。

## 自动化接线（v0.6.0）

模板不再是「照着骨架手工粘贴」，而是可 dry-run、可校验、可重复执行的配置补丁：

| 命令                                                   | 作用                                                |
| ------------------------------------------------------ | --------------------------------------------------- |
| `pnpm auth:email-config`                               | 默认 dry-run：读取线上配置并打印将修改的字段        |
| `pnpm auth:email-config -- --apply`                    | 写入模板 + 重定向白名单（需自定义 SMTP 或付费套餐） |
| `pnpm auth:email-config -- --apply --scope=redirects`  | 只写重定向白名单（免费版可用）                      |
| `pnpm auth:email-config -- --verify --scope=redirects` | 只读校验，CI 漂移门禁用                             |

- 单一来源：`scripts/lib/auth-email-templates.js`（5 个模板的 subject/content + 白名单合并规则）。
- 安全约束：生成前硬校验每封邮件都含自己的 CTA 变量（`.ConfirmationURL` / `.InviteURL`）与品牌头，
  缺少即抛错，避免把无法完成动作的模板推上线。
- 凭据：`SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`；脚本不会回显响应体中的密钥，
  错误摘要只取 API 的 `message` 并截断到 200 字符。
- 视觉一致性：`src/lib/auth-email-templates.test.ts` 交叉校验 Auth 模板骨架与站内邮件渲染器
  （`src/lib/email-template.ts`）同色板、同 600px 表格布局、同安全提示文案。

## 应用通知邮件管线（v0.4.0 已落地）

> 状态：发送通道**已接线**（Resend），入口为 `POST /api/cron/digest`
> （`src/app/api/cron/digest/route.ts`），由 `vercel.json` 的 `0 9 * * *` 每天调度；Vercel Hobby Cron 每天最多一次。

- 拉取：`listUnsentEmailNotifications()`（未读 + `email_sent=false` + 白名单类型，默认
  `team_invite/role_changed/payment_succeeded/security_alert`，时间正序，默认 100 条）
- 回执：`markEmailSent(id)`（发送成功后标记，避免重发）
- 用户偏好门控：发送前用 `shouldSendEmail()`（`src/lib/notification-prefs.ts`）检查
  `profiles.notification_settings`，矩阵如下（站内通知中心不受偏好影响，全量展示）：

  | 通知类型                                                                 | 偏好开关                                           |
  | ------------------------------------------------------------------------ | -------------------------------------------------- |
  | system / team_invite / role_changed / payment_succeeded / billing_update | emailNotifications（总开关，关则全停）             |
  | deployment                                                               | productUpdates                                     |
  | security_alert                                                           | securityAlerts                                     |
  | （营销邮件）                                                             | marketingEmails（独立通道，不经 notifications 表） |

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

### 调度与发送时刻（v0.5.0 A04 → 2026-09-22 移除错峰门控）

- 调度声明在 `vercel.json`（`{"path":"/api/cron/digest","schedule":"0 9 * * *"}`，每天 09:00 UTC；Hobby 每天最多一次），
  与 worker 注册表 `src/lib/observability/cron-contract.ts` 逐字一致，由
  `pnpm check:cron-contract` 强制；自建调度器按同样频率调用即可。
- 发送时刻：每轮给**每个有待发邮件通知的用户**发一封摘要，单次 cron 最多处理 100 条。
  2026-09-22 起不再按 `profiles.timezone` 判断「本地是否 08:00」——Hobby plan 每路径每天只能
  调度一次，一个固定 UTC 时刻不可能落进所有人的早晨，那道门控的实际效果是让 UTC-1 时区带
  之外的用户永远收不到摘要。要恢复「贴着本地早晨投递」需要再加一条 cron 路径或外部逐小时
  调度器，而不是放宽门控（权衡记录见 `docs/roadmap-0.12.0.md` A01）。
- Vercel Cron 自动附加 `Authorization: Bearer <CRON_SECRET>`，手工触发仍可用
  `x-cron-secret`；两种方式都被接受，鉴权失败会产出
  `cron.auth.rejected{worker="digest",reason=...}`，便于区分「没调度」与「鉴权没配对」。

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

### 营销邮件独立通道（v0.5.0 A05）

- 不经过 `notifications` 表，受众来自 `marketing_subscriptions`（迁移 016，仅
  `status=subscribed` 的行），`profiles.notification_settings.marketingEmails`
  是订阅入口开关而非直接发送授权。
- **Double opt-in**：设置页打开开关 → 写入 `pending` 订阅（每用户一行，
  `user_id` 唯一，重复开关刷新 token 使旧链接失效）→ Resend 发确认邮件 →
  用户点击 `/api/marketing/confirm?token=…` → `subscribed`。关闭开关或点击
  `/api/marketing/unsubscribe?token=…` → `unsubscribed`。
- Token 为 48 位十六进制随机串（不可猜测），公开路由凭 token 操作；
  未命中返回 404，命中后 302 跳回站点首页（带 `?marketing=confirmed|unsubscribed`）。
- 发送入口 `sendMarketingEmail()`（`src/lib/email-marketing.ts`）：强制附加
  该收件人的退订页脚；批量营销/活动内容为后续任务，本版仅收口通道与合规链接。
- RLS：订阅行允许用户 select/insert/update 自己的行；确认/退订路由走
  service_role（无用户上下文）。

### 运行可观测（v0.5.0 C02/C03）

- **运行记录**（迁移 017 `email_worker_runs`）：每轮 digest 落一行
  `pulled/sent/groups/failed/duration_ms/error`；落表失败只记日志，不影响返回。
  无用户维度，RLS 启用且无策略（仅 service_role 可读写）。
- **积压告警**：每轮运行前统计待发通知总数（与拉取同一过滤口径，含死信排除），
  超过 `EMAIL_BACKLOG_ALERT_THRESHOLD`（500）时经 logApiError 上报 Sentry
  （同消息自动分组）；持续积压通常意味着 Resend 凭据失效或死信增多，需人工介入。
- **积压指标（v0.6.0 E04）**：无论本轮是否拉到通知，每轮都上报一次
  `email.backlog`（unit `count`，无 attributes），因此「队列长期非空」与「队列恒定为空」
  在图表上是两条可分辨的曲线；恰好等于阈值（500）不告警，只有严格大于才上报，
  判定边界由 `route.test.ts` 锁定。度量精度受限于本轮拉取上限（默认 100），
  但计数走独立的 `count` 查询，不受 limit 截断。
- **跳过计数（v0.12.0 A04）**：worker 里每一条**按用户条件跳过投递**的分支都必须上报
  `cron.digest.skipped`（unit `count`，`value` 是该用户被跳过的条数，`attributes.reason` 取
  `no_email` / `preference`）。这不靠自觉：`src/lib/observability/cron-skip-coverage.ts`
  在 `pnpm check:cron-contract` 里静态核对——带条件的 `continue` 若既没上报登记的 skip 指标、
  也没累加进本轮已上报的计数器（发送失败走的就是 `failed`），PR 阶段就直接失败。
  动机是错峰门控那次 P0：跳过不计数时，指标表现为 `pulled=N, sent=0, failed=0` 的「成功」。
  `reason=preference` 本身是用户选择的正常结果，只有与 `sent=0` 同时持续出现才说明队列里
  全是当前投递不掉的条目（出队语义见 `docs/roadmap-0.12.0.md` A05）。
- **口径单一事实源（v0.6.0 E04）**：进入邮件队列的类型集合收敛为
  `EMAIL_NOTIFICATION_TYPES`（`src/lib/repositories/notifications.ts`），
  拉取（`listUnsentEmailNotifications`）与积压计数（`countUnsentEmailNotifications`）
  共用同一常量，避免只改一处导致「计数很大但永远拉不到」的假积压。
- **空轮次耗时（v0.6.0 E04）**：空队列分支与正常分支一样记录真实
  `durationMs`（`Date.now() - startedAt`），不再写死 0，`cron.digest.completed`
  的耗时样本因此不会出现无意义的零值尖峰，便于区分「worker 没跑」与「跑得很快」。

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

### 营销订阅 token 安全约束（迁移 017）

确认和退订接口现在只接受 `POST`，GET 仅展示无副作用的确认/退订表单，实际状态变更必须通过 `POST`，避免邮件安全扫描器、预取器或爬虫触发状态变更。邮件链接仍保留原有 URL 形态以兼容历史邮件和 mock/E2E；客户端应将 URL 中的 token 提交到对应 POST 接口（支持 query、JSON 或 form body）。

新生成的 token 以 SHA-256 摘要存储，并设置 7 天有效期；服务端不会依赖数据库中的明文 token 进行新请求匹配。迁移会将既有 token 回填为摘要并补充有效期；重新开启订阅会生成新的安全 token 并刷新有效期。过期或格式不合法的 token 返回无效，不改变订阅状态。
