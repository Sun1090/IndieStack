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
- Preview 环境的 `NEXT_PUBLIC_MOCK_ENABLED` 保持未设置（走真实 Supabase）
- Stripe 使用 test key；生产 webhook secret 不进 preview

## 免费版保活与自动恢复

Supabase 免费版项目 7 天无活动会被暂停，本仓库用三层兜底：

| 层级   | 触发方式                                      | 时间（UTC）  | 作用                                               |
| ------ | --------------------------------------------- | ------------ | -------------------------------------------------- |
| 保活主 | Vercel Cron → `/api/health`                   | `0 2 * * *`  | 每次探测触发一次 `profiles limit(1)` 查询          |
| 保活备 | `.github/workflows/health-check.yml`          | `17 3 * * *` | GitHub schedule 60 天静默后会被停用，仅作备份      |
| 恢复主 | Vercel Cron → `/api/ops/supabase-restore`     | `0 4 * * *`  | 不受仓库静默影响；`INACTIVE` 时调用 Management API |
| 恢复备 | `.github/workflows/supabase-auto-restore.yml` | `37 4 * * *` | 手动触发默认 `dry_run=true`                        |

- 保活与恢复探测共用有限重试：冷启动或瞬时 5xx/网络错误最多尝试 3 次（间隔 5 秒）；
  404/401 等确定错误和持续故障仍会失败，不会把真实故障静默吞掉。
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
