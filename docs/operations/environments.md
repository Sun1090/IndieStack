# 环境与 Staging 规范

## 环境拓扑

| 环境     | 分支         | Vercel                        | Supabase                       |
| -------- | ------------ | ----------------------------- | ------------------------------ |
| 本地开发 | feature/*    | `pnpm dev`（Mock 模式可离线） | 本地 supabase start / Mock     |
| Preview  | PR / develop | Vercel 自动 preview 部署      | **共享 staging Supabase 项目** |
| 生产     | main         | Vercel production 域名        | 生产 Supabase 项目             |

## Staging 数据库规范

1. **独立项目**：staging 与生产必须是两个 Supabase 项目，严禁共用
2. **迁移先行**：schema 变更先在 staging 验证（`supabase db push`），确认后再对生产执行
3. **数据脱敏**：如从生产导入数据到 staging，必须脱敏（用户邮箱/手机号替换）
4. **种子数据**：使用 `supabase/seed.sql` 维护 staging 演示数据。该 seed 自包含且可重复执行：
   会先写入三个 Auth 用户（`seed-owner-a@example.com`、`seed-owner-b@example.com`、
   `seed-member-a@example.com`，统一密码 `indiestack-local`），再写入两个隔离团队及项目、订阅、
   邀请、API key、通知等数据
5. **种子密码边界**：`indiestack-local` 是公开固定值，只允许用于 local/staging；
   绝对不要在可被公网访问的环境执行该 seed，生产账号必须走真实注册流程
6. **身份矩阵验证**：改 schema / RLS / Storage policy 后，在本地或 staging 执行
   `pnpm smoke:supabase-identity`（anon/authenticated/service_role 三种身份、20 项检查），
   证据与局限见 [../db/security-audit.md](../db/security-audit.md)

## Preview 安全

- Vercel Deployment Protection 建议开启（防止 preview 被搜索引擎收录）
- Preview 环境的 `NEXT_PUBLIC_MOCK_ENABLED` 保持未设置（走真实 Supabase）。这条约定过去只靠人守：
  Vercel 的 preview 与 production 跑的是同一种构型（`NODE_ENV === "production"`），而显式开关当时
  **没有**生产闸门，一个忘在 Preview 环境组里的 `true` 就会让对外可见的预览站发假登录用户。
  现在 `evaluateMockMode()` 对生产构型一律返回 `false`，误设的结果是「按真实凭据走、缺凭据就如实失败」，
  不再是静默的 mock。
- 仓库里**看得见**的生产配置（`.env.production`、`vercel.json`）另有 `pnpm check:security`
  的 `inspectProductionMockSettings` 规则：任一处把 `NEXT_PUBLIC_MOCK_ENABLED` 设成 `true` 即红。
  这不是重复运行时那道闸，而是为了让「生产不开 mock」这句话有第二份可核对的出处——
  `RATE_LIMIT_LEDGER` 里 18 条 mock 豁免与 `ROUTE_AUTH_LEDGER` 里整族 `mock-only` 的理由都写着
  「它们只在 mock 构型下存在」，那句话说错了没有人会知道。E2E 与本地开发面**不**在这条规则内：
  `e2e-parallel.yml` 开着 mock 跑 `pnpm build` 是对的，按「出现 MOCK 字样」判会直接把它判红。
- Stripe 使用 test key；生产 webhook secret 不进 preview

## 外部依赖实况（2026-10-05 观测，每行附可重跑的查询命令）

**这张表为什么存在**：2026-10-05 一天之内，我连续三次把「依赖外部状态」的结论写错
（Supabase 配没配、Sentry 有没有告警链路、B04 缺什么凭据），三次都是**没去查就写**。
而每次去查都很便宜。根因不是记性，是**这些事实散落在各文档里、没有统一出处**。

所以规则是：**任何关于外部状态的结论，都必须落在这张表里，并带上观测命令与日期。**
散落在别处的同类说法一律以本表为准。

| 依赖 | 实况（2026-10-05） | 观测命令 | 影响 |
| ---- | ------------------ | -------- | ---- |
| Supabase（平台 API） | ✅ 可用 | `gh run list --workflow supabase-auto-restore.yml`（每天 success） | Management API 令牌有效 |
| Supabase（Auth 配置读） | ✅ 可用 | `gh run list --workflow security-config.yml`（最近一轮输出「Auth 配置已验证（scope=redirects）」） | 同上，另一条独立证据 |
| Supabase（数据库级） | ❌ **无 DB 密码类 secret** | `gh secret list`（只有一个 `SUPABASE_ACCESS_TOKEN`） | **B04 的真正阻塞**：演练 SQL 与 `migration list --linked` 都要真 Postgres 连接 |
| 生产 Supabase（应用侧） | ✅ 配置且可达 | `pnpm health:check -- https://indie-stack-theta.vercel.app` | digest / 保留期路径在线上是活的 |
| Sentry | ❌ 生产未配 DSN | 同上（输出 `sentry: configured=false status=missing`） | **告警链路空转**，详见 `sentry-alerts.md` 开头 |
| Stripe | ❌ 生产未配 key | 同上（输出 `stripe: configured=false status=missing`） | 支付路径线上无流量，checkout 未上线 |
| Resend | ❓ **未知** | —— | provider 诊断只在 admin 后台，匿名 404；从外部判不了 |
| GitHub 保活变量 | ✅ 已配置 | `gh variable list`（`HEALTHCHECK_URL`） | 每日保活 workflow 在跑 |
| Vercel 构建配额 | ⛔ 限流中 | PR 上的 `Vercel – indie-stack` 检查（2026-10-05 报 `retry in 24 hours`） | preview 部署排队，非代码缺陷 |

**三条要读出来的分寸**：

1. **`configured=false` 不等于 readiness 会红**。`/api/health` 里 Sentry / Stripe 都是
   `required: false`，所以它们缺失时 `ready` 仍是 `true`——这是有意的设计（模板的可选依赖），
   但它意味着**一个可选依赖缺失时，健康检查不会替你喊人**。
2. **「平台可用」不等于「数据库可用」**。两者差着一层：Management API 能读项目状态，
   **读不到库里的表**。把前者当成后者会让人以为 B04 快能做完了。
3. **`❓ 未知` 是这一栏允许存在的状态**。写一个听起来合理的猜测，比写「未知」有害——
   本文档开头的那些错误结论，一半是被一个自信的猜测撑起来的。

## 免费版保活与自动恢复

Supabase 免费版项目 7 天无活动会被暂停，本仓库用三层兜底：

| 层级   | 触发方式                                      | 时间（UTC）  | 作用                                               |
| ------ | --------------------------------------------- | ------------ | -------------------------------------------------- |
| 保活主 | Vercel Cron → `/api/health`                   | `0 2 * * *`  | 每次探测触发一次 `profiles limit(1)` 查询          |
| 保活备 | `.github/workflows/health-check.yml`          | `17 3 * * *` | GitHub schedule 60 天静默后会被停用，仅作备份      |
| 恢复主 | Vercel Cron → `/api/ops/supabase-restore`     | `0 4 * * *`  | 不受仓库静默影响；`INACTIVE` 时调用 Management API |
| 恢复备 | `.github/workflows/supabase-auto-restore.yml` | `37 4 * * *` | 手动触发默认 `dry_run=true`                        |

- 保活与恢复探测共用有限重试：冷启动或瞬时 5xx/网络错误最多尝试 3 次（间隔 5 秒）；
  GitHub workflow 的 `health_url` 或仓库变量 `HEALTHCHECK_URL` 可填部署根地址，也会统一解析到 `/api/health`；404/401 等确定错误和持续故障仍会失败，不会把真实故障静默吞掉。
- 恢复只在 Management API 明确返回 `status=INACTIVE` 时发生；`RESTORING`/`COMING_UP` 等中间态
  只记录不写操作，`REMOVED` 等终态显式失败交给人工。
- 恢复主层需要 Vercel 环境变量 `CRON_SECRET` + `SUPABASE_ACCESS_TOKEN`（`SUPABASE_PROJECT_REF`
  可留空，从 `NEXT_PUBLIC_SUPABASE_URL` 推断）；缺配置时生产返回 503，避免静默失效。
- Secrets 只以加密形式保存于 GitHub/Vercel，协作者通常只能看到名称；拥有管理权限的
  所有者/管理员可以轮换或删除，因此令牌轮换后需同步更新两处。

## Auth 邮件与重定向白名单

- 生产 Supabase 项目（`ntqggnztzvoavjbiillb`）的重定向白名单已包含本地、生产别名与 Vercel preview
  通配域名；`pnpm auth:email-config -- --verify --scope=redirects` 可随时复核，CI 的
  `Security and configuration checks` 也会在 push/PR/周计划上做漂移门禁。
- Auth 邮件模板固化在 `scripts/lib/auth-email-templates.js`（设计稿
  [design/email-templates.md](../design/email-templates.md)）。当前套餐使用默认发件人，
  Management API 会拒绝模板写入，因此 CI 门禁只校验白名单；配置自定义 SMTP 后应改为
  `pnpm auth:email-config -- --verify`（scope=all）。
- 默认发件人的 `rate_limit_email_sent = 2`（全项目每小时 2 封）是注册量增长后的硬瓶颈，
  上线前必须换成自定义 SMTP，否则注册确认/邀请/重置会直接失败。
- Preview 部署若要完成登录回跳，域名必须落在白名单内；新增自定义域名时同步更新
  `scripts/lib/auth-email-templates.js` 的 `PREVIEW_REDIRECT_PATTERNS`。

## 发布流程

```
feat/* → develop → staging 验证 → PR 到 main → CI 七关 → Vercel 自动部署 → 部署验证清单
```

详见 [agents/10-release-manager.md](../../agents/10-release-manager.md) 的部署验证清单。

## `NEXT_PUBLIC_*` 是构建期常量

- 值在 `next build` 时被写进产物，运行时改平台上的值**不会**改变已部署的产物；改完必须重新构建部署。
- 只有**构建时真实存在**的变量才会被内联。没设过的 `NEXT_PUBLIC_*` 在客户端产物里留下的是
  对 `process.env` 的读取，而浏览器里那个 `process` 是空垫片（实测 `typeof process === "undefined"`），
  读到 `undefined` —— 所以「客户端读一个只在平台上设过的变量」这件事必须显式验证，不能靠推。
- **计算式访问永远不会被内联**：`process.env[key]` 以及用模板串拼出来的键都不行，
  必须是 `process.env.NEXT_PUBLIC_X` 这种静态成员写法。`src/lib/feature-flags.ts` 的形状断言钉着这条。
