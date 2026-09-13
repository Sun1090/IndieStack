# Provider 配置诊断

`pnpm provider:doctor` 把模板里的可选集成汇总成一份不包含凭据的配置报告。它在启动前回答的
核心问题是：**当前部署会静默关闭某个功能、回退到另一个 provider，还是会因为半套配置而失败？**

诊断命令只读取当前进程的环境变量，不发起网络请求，也不打印任何凭据值，因此可以安全地用于
本地终端、部署日志和新人环境检查。

```bash
pnpm provider:doctor
pnpm provider:doctor --json
```

退出码 `0` 表示没有阻塞性的配置问题；完全未配置的可选 provider 会显示为 `off`，不会导致失败。
退出码 `1` 表示必需 provider 缺失，或某个 provider 只配置了一部分。

## 状态模型

| 状态 | 含义 | 是否阻塞部署 |
|------|------|--------------|
| `ready`（`ok`） | 最小运行时配置齐全，或明确的回退路径已生效。 | 否 |
| `disabled`（`off`） | provider 变量全部缺失，功能保持关闭。 | 可选 provider 为否；Supabase 只在 Mock 模式下显示为该状态 |
| `degraded`（`warn`） | 功能可用，但配套的非运行时配置不完整。 | 否，但发布前应复核 |
| `misconfigured`（`error`） | 配置了部分变量，但配置不完整。 | 是 |
| `missing`（`missing`） | 非 Mock 模式下缺少必需 provider。 | 是 |

报告还会在支持回退的 provider 上标记 `provider=mock`、`provider=supabase` 或 `provider=oss`。
OSS 只配置一部分始终是错误，因为那意味着操作者试图启用 OSS，但运行时仍会静默回退到
Supabase Storage。

## 覆盖的 provider

| Provider id | 运行时 / 回退 | 环境变量 | 部分配置或缺失时的行为 |
|-------------|---------------|----------|------------------------|
| `supabase` | Supabase 数据库、Auth 与管理客户端 | `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_URL` | 非 Mock 模式下缺少运行时 key 属于阻塞；运行时 key 齐全但缺少 `SUPABASE_DB_URL` 只会告警，因为迁移脚本无法直连数据库 |
| `storage` | OSS 配置齐全时使用 OSS，否则使用 Supabase Storage | `OSS_BUCKET`、`OSS_REGION`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 完全没有 OSS key 时使用 Supabase 回退；只配置一部分会标记 `misconfigured`，但运行时仍回退 Supabase |
| `email` | Resend HTTP API | `RESEND_API_KEY`、`RESEND_FROM`、`RESEND_API_URL` | 没有 API key 时邮件关闭；只配置 `RESEND_FROM` 等覆盖项会标记 `misconfigured` |
| `webpush` | 基于 VAPID 的浏览器 Web Push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`NEXT_PUBLIC_APP_URL` | 两个 VAPID key 必须同时存在；只配置一个会标记 `misconfigured`。`NEXT_PUBLIC_APP_URL` 用于 VAPID 联系主体，缺省时回退到 mailto |
| `appark` | Appark APM | `NEXT_PUBLIC_APPARK_API_KEY`、`NEXT_PUBLIC_APPARK_ENDPOINT` | 两项必须同时存在；只配置一项会标记 `misconfigured`，运行时保持旁路 |
| `stripe` | Stripe Checkout、客户门户、Webhook 校验与价格 | `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`STRIPE_PRO_PRICE_ID`、`STRIPE_ENTERPRISE_PRICE_ID` | 全部缺失时计费关闭；任何部分配置都会标记 `misconfigured`，因为 checkout 或 webhook 可能失败 |
| `sentry` | Sentry 运行时错误与 source map 上传 | `NEXT_PUBLIC_SENTRY_DSN`、`SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN` | 运行时 DSN 存在但构建 key 缺失时标记 `degraded`；有构建凭据但无 DSN 时标记 `misconfigured` |
| `supabase-restore` | 免费版自动恢复的管理 API 路由 | `SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_REF` | 启用时必须两项齐全。`SUPABASE_PROJECT_REF` 可以从标准 `<ref>.supabase.co` URL 推断；有 token 但无法推断 ref，或有 ref 但无 token，都会标记 `misconfigured` |
| `cron` | 定时路由鉴权 | `CRON_SECRET` | 缺少 `CRON_SECRET` 时定时路由安全关闭；需要 Vercel Cron 或外部调度器调用时再设置 |

## 常见工作流

### 本地 Mock 模式

设置 `NEXT_PUBLIC_MOCK_ENABLED=true`，或在非生产环境不设置 Supabase URL。此时
`provider:doctor` 会把 Supabase 标记为 `off`、存储标记为 Mock 回退，并且不会因为外部服务缺失
而失败。内存数据与请求隔离模型见 [Mock 模式](./mock)。

### Staging / 生产的 Supabase 配置

提供三个运行时 key 以及 `SUPABASE_DB_URL`。如果报告出现
`supabase: degraded (SUPABASE_DB_URL)`，说明应用可以提供服务，但 `pnpm db:migrate`、
`pnpm db:types` 等直连数据库的脚本无法工作。

### 启用 provider 时避免意外回退

一个 provider 要么配置全部 key，要么全部留空。诊断命令刻意把半套配置视为错误，而不是猜测
操作者意图。`storage` 尤其需要注意：OSS 半套配置在运行时仍会静默使用 Supabase Storage，但
doctor 会报告 `storage: misconfigured`。

### 读取 JSON 报告

```bash
pnpm provider:doctor --json
```

JSON 结构可供自动化使用：

```json
{
  "ok": true,
  "mockMode": false,
  "nodeEnv": "production",
  "providers": [
    {
      "id": "supabase",
      "label": "Supabase core",
      "status": "ready",
      "required": true,
      "configured": true,
      "missing": [],
      "notes": ["Runtime, admin client, and database migration configuration are present."]
    }
  ],
  "problems": [],
  "warnings": []
}
```

上面的样本经过省略，实际报告包含全部 provider。`missing` 中只出现变量名，不会出现变量值。

## 排障对照表

| 报告行 | 处理方式 |
|--------|----------|
| `supabase: missing (...)` | 补齐运行时 key；本地开发也可以启用 Mock 模式。生产中这是部署阻塞项。 |
| `supabase: degraded (SUPABASE_DB_URL)` | 在跑迁移或生成数据库类型前设置 `SUPABASE_DB_URL`。 |
| `storage: misconfigured` | 补齐剩余 OSS key，或删除全部 OSS key 以使用文档中的 Supabase 回退。 |
| `email: misconfigured` | 删除 Resend 覆盖项，或补上 `RESEND_API_KEY`。 |
| `webpush: misconfigured` | 补齐缺失的 VAPID key；两个 key 必须来自同一组密钥对。 |
| `appark: misconfigured` | 补齐缺失的 Appark key，或删除两项让 APM 保持关闭。 |
| `stripe: misconfigured` | 启用计费前补齐五个 Stripe 值。 |
| `sentry: degraded` | 如需上传 source map，补齐 `SENTRY_ORG`、`SENTRY_PROJECT`、`SENTRY_AUTH_TOKEN`；否则运行时错误捕获仍可用。 |
| `supabase-restore: misconfigured` | 同时补上 `SUPABASE_ACCESS_TOKEN` 与 `SUPABASE_PROJECT_REF`，或删除两项关闭自动恢复。 |
| `cron: off` | 只在需要定时路由可调用的环境设置 `CRON_SECRET`。 |

## 文档门禁

`pnpm check:provider-docs` 会用 `src/lib/providers/diagnostics.ts` 中的 provider 注册表校验
本页的中英文版本。新增 provider 或环境变量却未同步两份文档时，门禁会失败。该检查已接入
`pnpm check:all` 与 CI 的 `Lint & Type Check` job。
