# Changelog

All notable changes to IndieStack will be documented in this file.

## [Unreleased]

### Added

- **上传对象元数据表（孤儿对象可枚举）**：新增 `031_upload_objects.sql` 的
  `public.upload_objects`，记录每次 `put` 的 bucket / object key / 所有者 / 字节数 / MIME /
  sha256 / 状态，`(bucket, object_key)` 唯一，替换或回滚时把旧行标记 `deleted`，使
  `status = 'active'` 直接等于「数据库认为应该存在的对象」，可与 bucket 实际列表做双向差集找孤儿。
  上传服务改为 `put → 落元数据 → 回写业务表`，元数据写失败即删除对象并返回 `uploadFailed`
  （不再产生没有登记的公开对象），旧对象删除失败则不标记 `deleted`（避免漏报）。
  该表 RLS 打开且零策略、额外收回 `anon` / `authenticated` 写权限，只有 service_role 可读写；
  新增 `src/lib/repositories/upload-objects.ts`、`src/lib/uploads/checksum.ts`，mock 支持复合
  `onConflict`，并登记进 service-role 清单与 server-only 表分类。数据模型、写入协议、运行时
  身份矩阵与巡检 SQL 见 [docs/db/upload-metadata.md](docs/db/upload-metadata.md)。

- **Storage bucket 策略审计跟随代码，而不是写死的 `avatars`**：新增
  `src/lib/security/storage-policies.ts`，从 `src/**` 发现所有被引用的 bucket、从迁移最终态
  （`create policy` / `drop policy` 归约）推导生效的 `storage.objects` 策略，再做交叉验证：
  未登记 bucket（`STORAGE_BUCKET_UNDECLARED`）、没有建行迁移（`STORAGE_BUCKET_UNVERSIONED`）、
  没有生效策略（`STORAGE_BUCKET_UNPOLICED`）、写策略未同时钉住 `bucket_id` 与 `auth.uid()`
  目录（`STORAGE_WRITE_POLICY_UNSCOPED`）、读策略没有 `bucket_id` 过滤
  （`STORAGE_READ_POLICY_UNSCOPED`）、私有 bucket 出现客户端读策略
  （`STORAGE_PRIVATE_BUCKET_PUBLIC_READ`）、公共读 bucket 缺少客户端 SELECT
  （`STORAGE_PUBLIC_BUCKET_UNREADABLE`）全部失败封闭。新增 20 条单测与
  [docs/db/storage-policy-audit.md](docs/db/storage-policy-audit.md)（含真实数据库目录核对与 6 行身份矩阵）。


- **邮件 worker 运行记录保留期**：新增 `027_email_worker_runs_retention.sql`，`cleanup_old_email_worker_runs()`
  按 90 天保留期清理 `email_worker_runs`（与 `notifications` / `webhook_events` 对齐），并通过带
  守卫的 `pg_cron` 任务每周日 04:15 执行（未安装 `pg_cron` 的环境自动跳过）；`security definer` +
  空 `search_path`，只按 `created_at` 时间窗批量删除。保留策略矩阵更新到 [docs/db/retention.md](docs/db/retention.md)。
- **Push 重试链路 E2E 覆盖**：新增 mock-only 的 `https://push-e2e.test` 保留端点传输层
  （`src/lib/mock/push-transport.ts`）与 `/api/e2e/push-queue` 种子/查询/重置端点，
  只替换 `web-push` 的底层 `https.request`，适配器的配置校验、载荷构造与错误映射保持真实；
  新增 `e2e/push-retry.spec.ts` 10 条用例覆盖 401 鉴权、空队列、成功投递、瞬时失败退避、
  超过重试上限进入死信、410 撤销订阅、订阅缺失、用户关闭 Push、通知行缺失与终态保留策略清理。
  该覆盖补齐 v0.8.0 发布文档缺口审计中记录的已知缺口（mock-only，不等同于真实 push service 验证）。

### Changed

- **依赖补丁刷新**：`next` / `eslint-config-next` / `@next/bundle-analyzer` 16.3.4 → 16.3.5，
  `next-intl` 4.14.3 → 4.14.4，`lucide-react` 1.44.0 → 1.45.0；`eslint` 10 与 `typescript` 7
  两个 major 升级需要专项迁移，本次不动（`pnpm dep:health` 继续跟踪）。
- **Stripe Webhook 幂等键收窄为 `(provider, event_id)`**：`webhook_events` 的唯一约束由
  `event_id` 单列改为 `(provider, event_id)` 复合唯一，并新增 `attempts` / `last_attempt_at`
  两列记录占位次数与最近一次占位时间（迁移 `030`）。避免将来接入第二个 provider 时 event id
  互相碰撞，同时让"某个事件被 Stripe 重试了多少次"直接可查。
- **审计日志分页不再请求精确总数**：`listAuditLogsPage()` 默认不再下发 PostgREST
  `count: "exact"`，改为可选 `{ withExactTotal: true }`，默认返回 `total: null`。
  `audit_logs` 永久保留、只追加，全表 `count(*)` 是这条查询里唯一随表增长的开销：
  本地 20 万行 `EXPLAIN ANALYZE` 实测 `select count(*)` 走 Parallel Seq Scan 12.99ms / 6956 buffers，
  而生产分页路径 `order by created_at desc limit 50` 走 `idx_audit_logs_created_at` 仅 0.082ms / 53 buffers。
  当前无调用方读取 `total`（管理页显示 `filteredLogs.length`），如需总量应改用 `count: "planned"`。
  复审数据见 [docs/db/index-review.md](docs/db/index-review.md)。

### Fixed

- **Stripe Webhook 重复投递不再重放副作用**：此前 `webhook_events` 只是"最后写一行日志"的
  记录表，处理器**先执行全部副作用**（写订阅状态、发"付款成功"通知）再 upsert，而 Stripe 是
  at-least-once 投递且会对非 2xx 重试，同一 `event.id` 反复投递会**重复写订阅、重复发通知**；
  F05 的"重复 event id 幂等"用例只断言日志行数，因此无法发现。现改为**先占位 → 再处理 → 后落状态**
  的租约模型：新增 `claim_webhook_event()`（`security definer` + 空 `search_path`，只授予
  `service_role`）原子占位，重复投递返回 `duplicate` 并回 200 且不执行任何副作用；副作用失败标记
  `failed` 并回 500，让 Stripe 的下一次重试可以重新占位（`attempts` 累加）；`received` 停留超过
  15 分钟（进程崩溃）同样可回收。占位 RPC 报错时**失败封闭**成 500 而非降级为 `duplicate`
  （否则数据库故障会被伪装成"已处理"，Stripe 收到 200 停止重试而静默丢失状态同步）；副作用**成功
  后**的落状态失败只记日志、仍回 200（此时回 500 会让下次重试必然重放副作用）。E2E 断言从
  "日志行数"改为"副作用本身（通知行数）在两次投递后仍为 1"。协议、运维检查与回滚步骤见
  [docs/db/webhook-idempotency.md](docs/db/webhook-idempotency.md)。

- **RLS 全表回归门禁不再漏检策略**：`pnpm check:rls` 原先把策略名按"单个单词"截断
  （`"?([\w-]+)"?`），本仓库 35 条策略几乎全是带空格的句子
  （`"Users can view own profile"`），于是同表多条策略在最终态里互相覆盖、只报出 24 条，
  漏掉的 11 条 `USING` / `WITH CHECK` 从未被校验。现改为由纯函数
  `src/lib/security/rls-coverage.ts`（14 条单测）与 `check:supabase-security` 共用的最终态模型，
  并新增"每张表必须分类"规则：新表要么带策略，要么登记进 server-only 白名单
  （`email_worker_runs` / `mfa_recovery_codes` / `push_delivery_attempts` / `webhook_events`），
  否则 `TABLE_UNCLASSIFIED` 失败封闭。静态收敛结果与本地 `pg_policies` 逐条一致（35/35，双向零差集）。
  详见 [docs/db/security-audit.md](docs/db/security-audit.md)。

### Security

- **service_role 最小权限清单门禁**：新增 `src/lib/security/admin-client-boundary.ts`，用 TypeScript AST
  清点**每一个** `createAdminClient()` 调用点——29 个模块、80 个调用点——并为每个模块登记
  surface、授权模型与必须保留的源码证据字面量。`pnpm check:supabase-security`（含 `pnpm check:all`）
  现对未分类模块、过期清单条目、调用点漂移、未登记的表/RPC/bucket/`auth.admin` 方法、
  `use client` 模块引用与证据字面量缺失全部失败封闭。此前新路由只要 import 一次 admin client
  即可绕过评审直接读写任意表。同时 `/api/health` 不再持有 service_role：未鉴权的公开端点改用
  anon key 证明 PostgREST 可达（readiness 仍要求三个凭据齐全）。详见
  [docs/db/security-audit.md](docs/db/security-audit.md)。
- **审计日志写入面收口**：新增 `029_audit_logs_write_lockdown.sql`，删除
  `audit_logs` 上遗留的宽松 INSERT 策略
  `"Audit logs insertable by authenticated users"`（`with check (auth.role() = 'authenticated')`），
  并收回 `anon` / `authenticated` 的表级 INSERT/UPDATE/DELETE/TRUNCATE 权限。该策略对写入行内容
  零约束，任意登录用户可直接 `POST /rest/v1/audit_logs` 伪造审计记录并把 `user_id` 指向他人
  （本地复现为 HTTP 201）。服务端写入路径（`appendAuditLog()` 走 `service_role`，具备
  `BYPASSRLS`）与 `log_audit_action()` 均不受影响；`pnpm check:supabase-security` 新增
  `src/lib/security/client-write-policies.ts` 规则，对 server-only 表上残留的客户端写策略、
  以及缺失或恒真的 INSERT `WITH CHECK` 失败封闭。
- **SECURITY DEFINER 执行权限收口**：新增 `028_revoke_security_definer_execute.sql`，收回
  `cleanup_old_notifications()` / `cleanup_old_webhook_events()` / `cleanup_old_email_worker_runs()`
  与 `log_audit_action()` 对 `PUBLIC` / `anon` / `authenticated` 的 `EXECUTE`。此前 PostgreSQL 默认
  把函数 `EXECUTE` 授予 `PUBLIC`（Supabase 默认权限再显式授予 `anon` / `authenticated`），
  匿名用户可直接 `rpc('cleanup_old_notifications')` 强制删除保留期内的数据，或
  `rpc('log_audit_action')` 伪造审计日志；`pnpm check:supabase-security` 同步升级为对未撤权的
  `SECURITY DEFINER` 函数失败封闭（自动豁免 RLS 策略引用与触发器函数）。

## [0.8.0] — 2026-09-13

> 主题：**Web Push 持久化重试与死信队列**

### Added

- **Web Push 持久化重试与死信队列**：新增 `026_push_delivery_attempts.sql`，按
  `(notification_id, endpoint)` 持久化投递状态；瞬时失败按 60 秒起的指数退避重试，最多 3 次后进入死信，
  404/410 与订阅缺失会撤销端点并计入失效统计。新增受 `CRON_SECRET` 保护的
  `/api/cron/push-retry`（每 15 分钟、单轮 50 条），补充 `push.backlog`、死信与 worker 指标，
  站内通知和邮件通道不受 Push 失败影响。
- **Push 队列保留策略**：每次 cron worker 完成后清理超过 7 天的 `sent` 与超过 30 天的 `dead` 行，
  单一状态每轮最多清理 1000 行，`pending` 永不清理；响应新增 `pruned` 脱敏计数，并上报
  `push.queue.pruned` / `push.queue.prune_failed`，避免队列表无界增长。

### Fixed

- **Mock 范围查询时间比较**：修正 mock Supabase 的 `gte`/`lt`/`lte` 过滤，使 ISO 日期按时间戳比较、
  纯数字字符串按数值比较，并补上 `lte` 方法，支持在 mock-only E2E 中验证 Push 重试队列。

## [0.7.0] — 2026-09-12

> 主题：**Web Push 真实投递 + 安全与发布门禁加固**

### Added

- **通知中心实时刷新**：通知页通过 Supabase Realtime `postgres_changes` 订阅当前用户的
  `notifications` INSERT，并在 120ms 合并窗口后刷新列表；连接失败时显示离线状态并保留
  服务端渲染数据。新增 `025_notifications_realtime.sql`、组件测试和实时更新 E2E。
- **上传进度与取消**：头像和项目封面表单改为同源 XHR `/api/uploads/*`，显示真实
  上传百分比并支持取消；Route Handler 与 Server Action 共用上传领域 service，
  保留鉴权、MIME/文件头校验、大小限制、元数据回写失败回滚和旧对象清理。
- **Auth 邮件配置即代码**：新增 `scripts/lib/auth-email-templates.js` 与
  `scripts/apply-auth-email-templates.js`（`pnpm auth:email-config`），把
  [docs/design/email-templates.md](docs/design/email-templates.md) 的 5 封邮件骨架固化为可
  dry-run / apply / verify 的 Supabase Auth 配置补丁，并在生成前硬校验 CTA 变量与品牌头；
  CI `Security and configuration checks` 增加重定向白名单漂移门禁。
- **运行时身份矩阵**：新增 `pnpm smoke:supabase-identity`（`scripts/verify-supabase-identity.js`），
  使用真实 Auth + PostgREST + Storage API 验证 anon / authenticated / service_role 的
  租户隔离、`profiles` 可见范围、私有项目不可读与 `avatars` 前缀写权限；最近一次 20/20 通过，
  证据与局限记录在 `docs/db/security-audit.md`。
- **Supabase 自动恢复（应用侧兜底）**：新增 `/api/ops/supabase-restore` 与 Vercel Cron
  `0 4 * * *`。GitHub Actions 的 `schedule` 会在仓库 60 天无提交后被停用，因此恢复能力
  不再只依赖 GitHub；路由复用与 `scripts/supabase-auto-restore.js` 相同的判定（只有
  `status=INACTIVE` 才恢复），并以 `CRON_SECRET` 鉴权、`no-store` 返回结构化 action。
- **Passkey 完整登录闭环**：assertion 验签和计数器更新成功后，通过服务端一次性
  magiclink token 桥接 Supabase SSR 会话；token/action link/邮箱/userId 不返回
  浏览器或写入日志，已有 MFA 因子的用户继续完成 aal2 challenge。
- **视觉回归基线**：新增 `pnpm test:visual`（`playwright.visual.config.ts` +
  `e2e-visual/visual.spec.ts`），对首页、功能页、定价页和登录页做 1440×900 全页截图，
  像素差异门禁 0.1%；基线为 Linux Chromium PNG，需在
  `mcr.microsoft.com/playwright:v1.63.0-noble` 容器内生成，固定 UTC、浅色主题与
  禁用动画以消除环境抖动。CI 在 E2E 之后执行该套件，失败时上传 `test-results/` 差异图。
- **迁移漂移门禁（H09）**：`pnpm check:migrations` 从“只查文件名”升级为离线内容门禁，校验
  迁移命名、编号连续与唯一、空文件、UTF-8 BOM、CRLF、结尾换行，并把每个迁移的 SHA-256 与提交的
  `supabase/migration-manifest.json` 基线比对；新增 `pnpm update:migrations-manifest` 做仅追加的
  重新定基线，改写已基线化迁移会被拒绝，避免用重跑基线掩盖历史篡改。另新增只读的
  `pnpm check:migration-history`（需本地 `supabase start`）比对数据库迁移历史，对未应用迁移或
  数据库独有版本报错。规则由 `src/lib/migrations/migration-drift.ts` 的 43 条单测覆盖，静态门禁接入
  `pnpm check:all` 与 CI。

- **Web Push 真实投递**：`push-provider.ts` 从占位实现替换为真实 `web-push` 传输层（VAPID 鉴权、
  1 小时 TTL、10 秒超时、high urgency；缺密钥时 provider 保持 `configured=false` 并显式失败），
  新增 `push-notify.ts` 按用户扇出到全部订阅并撤销 push service 返回 404/410 的失效端点；投递接入
  通知事件边界，Push 失败不会抑制站内通知或邮件。设置页可在刷新后识别既有订阅并关闭通知
  （同时撤销数据库记录与浏览器订阅），新增 `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  配置与中英 docs-site 运维章节。当前 Push 为即时 best-effort，尚无持久化重试队列或死信表。

### Changed

- **CHANGELOG 结构门禁（I05）**：新增 `pnpm check:changelog`（`scripts/check-changelog.js` +
  `src/lib/changelog/parse-changelog.ts`），校验 `[Unreleased]` 置顶且非空、版本标题与发布日期格式、
  版本降序且不重复、每个版本至少一个章节、章节至少一个顶层条目、条目非空且未超长；门禁接入
  `pnpm check:all` 与 CI 的 Lint & Type Check job，规则本身由 38 条单测覆盖。
- **依赖与 secrets 扫描门禁（H10）**：`pnpm check:security` 改为纯策略模块 + Node type-stripping CLI，
  拒绝被跟踪的环境/私钥文件，校验环境文件权限与客户端服务端密钥泄漏，要求 workflow 显式最小权限，
  并锁定 gitleaks、CodeQL、security-config 和 Dependabot 的触发范围、版本与权限配置；补齐
  `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`，对 `pnpm audit --json` 的 high/critical 计数 fail-closed。
  规则由 54 条专项测试覆盖，继续接入 `pnpm check:all` 与 CI。
- **依赖安全刷新**：升级 React/React DOM 与类型包到 19.3.0，以及 Sentry、Stripe、
  next-intl、lucide-react、Zod 与 Node 类型的最新 minor/patch；`pnpm audit --audit-level high`
  无已知漏洞，`pnpm peers check`、`pnpm check:all`、`pnpm test:coverage`、`pnpm test:e2e`
  与 `pnpm verify:build` 全部通过。
- **种子数据重写**：`supabase/seed.sql` 改为自包含、可重复执行，先创建 `auth.users` 再写入
  两个隔离团队、三个项目、订阅、邀请、API key、会话、审计、通知与 usage 数据；修复了
  违反 `auth.users` 外键与 subscriptions 冲突目标无效导致的 `supabase db reset` 失败。
- **运维文档**：部署文档补充保活/恢复的双层结构与 `CRON_SECRET`、`SUPABASE_ACCESS_TOKEN`
  配置说明；安全审计文档用真实运行时矩阵替换“本地无法启动 Supabase”的过期描述。
- **测试与发布文档**：README 测试计数同步为 94 个文件 / 853 个测试，Smoke 记录更新到
  commit `16a285a` 与对应 Vercel 生产部署。
- **Auth 重定向白名单**：生产 Supabase 项目补入 Vercel preview 通配域名并回读校验通过
  （`http://localhost:3000/**`、生产别名、`https://*-sun1090s-projects.vercel.app/**`、
  `https://indie-stack-*.vercel.app/**`），preview 部署的登录回跳不再被白名单拦截。
- **Auth 邮件模板待启用**：Supabase 免费版 + 默认发件人禁止通过 Management API 修改模板
  （`rate_limit_email_sent = 2`，全项目每小时 2 封）。模板与命令已就绪，配置自定义 SMTP 或
  升级套餐后执行 `pnpm auth:email-config -- --apply`；在此之前该限制会在每次注册洪峰时先暴露。

- Passkey 登录选项、认证验证、注册选项和注册验证统一补齐 flag 门控、IP 限流、
  `no-store` 与失败后的 challenge cookie 清理；登录表单增加中英双语入口和共享 busy 状态。

### Fixed

- 英文页脚版权符号由 `&copy;` 改为 `©`：ICU 消息不解析 HTML 实体，此前英文站点页脚会
  原样显示 `&copy;`（中文文案一直使用 `©`）。

## [0.6.0] — 2026-09-12

> 主题：**发布门禁加固 + Supabase 免费版保活与自动恢复**

### Added

- **Release operations**：新增 v0.6.0 发布 runbook、生产 smoke test 矩阵和回滚 runbook，明确证据留存、停止条件、数据库向前兼容与回滚后验证。
- **Release documentation gate**：新增 `pnpm check:release-docs`，检查发布文档、双语 README、CHANGELOG 和关键操作命令是否存在且保持同步。
- **Supabase 免费版保活**：根目录 `vercel.json` 新增每日 Vercel Cron，`.github/workflows/health-check.yml` 追加每日 `schedule`（并改为免安装依赖、直接运行 `scripts/check-health.js`）；两者都探测 `/api/health`，触发一次 Supabase `limit(1)` 查询，避免免费版项目 7 天闲置被暂停。
- **Supabase 自动恢复**：新增 `supabase-auto-restore` workflow 与 Management API 脚本；每日检查项目状态，暂停时自动恢复，再等待数据库健康后退出，手动运行默认使用 `dry_run=true`。
- **Health readiness contract**：`/api/health` 增加 `ready`、`degraded` 和 `supabase.status`，保活与恢复脚本可区分“Web 正常但数据库未就绪”和完整可用。

### Changed

- **数据库迁移**：应用 022–024，补齐 MFA recovery codes 用户外键、营销 token 安全字段和 avatar storage policy；生产迁移前已保存 schema、roles 与业务数据快照。
- **Passkey 安全门禁**：验证接口默认关闭，只有显式设置 `NEXT_PUBLIC_FEATURE_PASSKEY_LOGIN=true` 且完成后端接入后才开放。
- **对象存储清理**：统一托管对象的替换/删除清理路径，避免头像与项目封面替换后遗留孤儿对象。
- **依赖与 CI**：升级 Vitest/coverage-v8 至 5.0.0、TypeScript 6.0.3 与 GitHub Actions；Dependabot 对 Vitest 同组升级，并忽略越过 Node 22 运行时大版本的 `@types/node`。
- **CI 安全基线**：各 workflow 默认只授予 `contents: read`，a11y 审计不再允许失败，新增依赖审计、i18n 使用检查、迁移漂移检查、Supabase 安全边界与仓库配置检查。

### Security

- 营销订阅确认/退订改为 POST 执行状态变更，GET 仅展示表单；新 token 使用 hash 和 7 天有效期。

### Fixed

- 修正 dashboard、API key、成员角色、资料完整度和项目删除等页面的 i18n key，避免生产构建时遗漏翻译。
- 保活、自动恢复和生产 smoke 探测改为有限重试瞬时网络错误、5xx 与未就绪 body，避免 Supabase 冷启动期间的 503 被误报为持续故障。
- 修复测试基础设施：Vitest 每个项目限制为 2 个 worker，Playwright 默认使用单 worker，避免高并发 jsdom / 共享 Mock 状态导致交互超时与互相清理；logger 仅在生产环境异步加载 Sentry，避免测试和构建进程加载监控运行时。

## [0.5.0] — 2026-09-05

> 主题：**邮件通道完善 + 对象存储接入 + 可观测性落地**

### Added

- **邮件通道完善（A 域）**：
  - 摘要同类型折叠：同类型 ≥3 条合并计数、明细截断 5 条 + 溢出提示（A01）
  - 发送失败重试计数与死信：`metadata.email_attempts` ≥3 由拉取侧过滤，不再阻塞队列（A02）
  - 高优先级通知实时单发：security_alert/team_invite/role_changed/payment_succeeded
    经 `notifyUser()` 事件触发即发，cron 兜底重试（A03）
  - digest 按用户时区错峰：本地 08:00 发送，空/非法时区回退 Asia/Shanghai（A04）
  - 营销邮件独立通道（迁移 016）：double opt-in 订阅确认 + 公开确认/退订路由 +
    强制退订页脚（A05）
- **对象存储（B 域，ADR-010）**：`StorageDriver` 双驱动抽象——默认 Supabase Storage，
  `OSS_*` 四项齐备切换阿里云 OSS（`ali-oss` 动态加载）；服务端中转上传
  （≤2MB，类型白名单/扩展名映射防穿越）；头像上传（B02）与项目封面（B03，复用
  `projects.logo_url`）接入
- **可观测性（C 域）**：Appark APM 轻量接入（ADR-011，无厂商 SDK、默认旁路关闭，
  checkout/cron 埋点）；cron worker 运行记录表（迁移 017，pulled/sent/failed/duration）；
  待发队列积压超阈值 Sentry 告警
- **认证安全（D 域）**：登录失败锁定收口进 rate-limit 键控滑窗并新增 IP 维度（D03）；
  会话设备列表与单设备吊销（迁移 018，GoTrue session id 登记心跳 + 设置页 UI，D02）；
  WebAuthn/Passkey 试点（迁移 019，feature flag 门控，注册/验证闭环，ADR-012，D01）
- **其他**：环境变量校验扩展（OSS/Appark 部分配置告警）

### Changed

- **TanStack Query 缓存策略统一（E02）**：`QUERY_KEYS` 单一来源 +
  `dashboardQueryOptions` 三档缓存档位（live/standard/admin），8 个调用点迁移
- **前端性能复审（E03）**：Supabase preconnect 补 `crossOrigin`（CORS TLS 复用修正），
  基线入档 `docs/operations/perf-baseline.md`

### Fixed

- 邮件模板 `String.replace` 特殊模式（`$&`）可能损坏用户内容 HTML 的隐患
- digest 空队列响应统一为 `{ sent, groups, failed }`
- dev 端 `components.json` 残留对已删除 `tailwind.config.ts` 的引用（`next build` 不读，
  `next dev` 会炸）
- `/(marketing)/contact` 表单 4 个 input 缺 `name` 属性（`id` 有但 server action 读 `formData.get(...)` 永远 null → submit 永远 `invalidInput` 失败；F02 E2E 复测发现并修复）

### Testing

- **E2E 邮件全链路（F01）**：`e2e/mail-flow.spec.ts` 覆盖 happy path（设置页开启营销邮件 →
  捕获 double opt-in 确认邮件 → 种通知 → 触发 digest cron → 断言摘要邮件主题含「N 条」
  - `email_worker_runs` 落表 pulled/sent/groups/failed）与 failure path（`?failNext=1`
    注入失败 → digest 返回 `failed=1` + `email_worker_runs.failed>0`）。
    Mock 端补：`MockQueryBuilder` 新增 `.or()/.not()/.contains()/.lt()/.is()/.upsert()`
    与 JSON 字段路径（`metadata->>email_attempts`）解析；`email_worker_runs` /
    `marketing_subscriptions` 表接入 mock 读写；mock profile `notification_settings`
    字段对齐真实 schema；`sendResendEmail` 支持 `RESEND_API_URL` 端点覆盖；
    E2E 专用路由（仅 mock 启用 + Bearer 校验）`/api/e2e/email-inbox`、
    `/api/e2e/seed-notifications`、`/api/e2e/email-worker-runs`、
    `/api/e2e/profile-timezone`（动态写入本机时区以命中 digest 错峰门控）。
    Playwright 配置注入 `RESEND_API_URL/KEY` + `CRON_SECRET` + `NEXT_PUBLIC_APP_URL` +
    `E2E_BEARER_TOKEN`；`pnpm test:e2e` 24/24 全绿（含 v0.4.0 既有 22 例 + F01 新增 2）。
- **E2E：admin / contact / MFA 页面（F02）**：`e2e/admin-contact-mfa.spec.ts` 覆盖 admin 概览页（统计卡片渲染）、admin/users 用户列表（mock 用户行可见）、admin/messages 消息列表可达、contact 表单 UI 流程（可达 + 字段填写 + submit 后无运行时错误）、mock contact_messages POST → GET 字段对齐（name/email/subject/message 全字段校验）。
  Mock 端补：mock 缓存切到 `globalThis.__indiestackMockCache__`，解决 Next.js 16 + Turbopack dev 将 server action 与 route handler 拆分到不同 chunk 时模块级 `let` 缓存不共享的问题（v0.5.0 F02 contact-messages 闭环踩到的真根因）；新增 `getMockContactMessages()` + `case "contact_messages"` 读写双路径；`/api/e2e/contact-messages` 提供 POST 端点（仅 mock + Bearer 校验）绕过 server action 跨进程不可见的限制；DELETE 走 admin client。Playwright 配置 `fullyParallel: false`（多 worker 并发会触发 DELETE/PATCH 互相覆盖），`pnpm test:e2e` 29/29 全绿（F01 24 + F02 5）。

### 质量

- 覆盖率门禁上调：branches 78 → 85（statements 91 / functions 93 / lines 92），
  实测 92.9 / 85.7 / 95.3 / 93.9；单测 556 → 668 个
- ADR 增补：ADR-010（对象存储）/ ADR-011（APM）/ ADR-012（Passkey）/ ADR-013（Tailwind v4 原生主题）
- **Tailwind v4 原生主题迁移（E01）**：移除 `@config` 桥接与 `tailwind.config.ts`，
  `@theme inline` + `@custom-variant dark` + `@utility container`；动画插件换成
  CSS-only 的 `tw-animate-css`（移除 tailwindcss-animate 依赖）
- 新增依赖：`ali-oss`（OSS 驱动，动态加载）、`@simplewebauthn/*`（Passkey 校验）

## [0.4.0] — 2026-09-05

> 主题：**Admin 运营闭环 + 数据层测试 + 集成接线**

### Added

- **两步验证（TOTP/MFA）全流程**：注册二维码/验证码确认/解除、登录挑战页 `/auth/mfa`（已验证因子强制 aal2）、备用恢复码（生成/兑换 + 前后端单测）
- **通知体系扩展**：通知类型常量（deployment/security_alert 等）、邀请/角色变更/支付成功的跨用户触发、邮件偏好联动矩阵（`notification-prefs`）、侧边栏未读 badge 轮询、单条/全部已读、读取失败错误态与空态引导
- **通知邮件 Worker**：`POST /api/cron/digest`（`CRON_SECRET` 鉴权）拉取待发通知 → Resend 发送 → `markEmailSent` 回执；按用户合并为摘要邮件，CTA 链接取 `NEXT_PUBLIC_APP_URL`（设计见 `docs/design/email-templates.md`）
- **联系消息运营闭环**：迁移 012/015（contact_messages + 处理状态机单向流转）、admin 收件箱（搜索/状态筛选/分页）、垃圾启发式拒收、联系页结构化数据
- **Admin 后台增强**：聚合看板（联系消息/webhook 事件统计）、用户列表服务端分页、webhook payload 查看、审计元数据 details 查看
- **登录安全**：失败分级锁定（邮箱滑窗 5 次/15 分钟）、登录审计日志（成功/失败/MFA/兑换/OAuth）、邮箱未确认时重发确认邮件、OAuth/MFA/会话丢失错误码 i18n 全覆盖
- **会话管理**：当前会话信息聚合 + 退出其他设备
- **数据保留策略**：迁移 014（pg_cron 守卫调度 + webhook 事件清理函数 + 策略文档 `docs/db/retention.md`）
- **API 质量**：错误格式统一收敛 `jsonNoStore`、日志 trace-id 统一（api-log）、health DB 自检、checkout 幂等/重复订阅拦截、og 缓存校验、未知 webhook 事件类型 Sentry 告警
- **环境变量校验模块**（zod 风格诊断 + 单测）
- **SEO/营销**：博客动态 OG 分享图、twitter card、sitemap 文章真实 lastmod、博客分类过滤、FAQ 搜索过滤、RSS feed、PWA manifest
- **UX 组件**：⌘K 命令面板（cmdk）+ 最近页面历史、面包屑导航铺开、QueryErrorState 错误重试铺开、EmptyState 统一空态、资料完整度卡片、离线横幅、路由进度条、定价页月/年切换（8 折年付）
- **测试覆盖**：repository 层 7 模块单测全覆盖、API 路由/actions 单测补齐（health/checkout/notifications/mfa/contact/webhooks）、safe-redirect fuzz/date 边界/CSV 注入变体、a11y 与 trace-id/CSP nonce E2E 断言

### Changed

- **TanStack Table v9 原生迁移**：移除 legacy 桥，显式 features + 行模型槽位（ADR-009）；DataTable 全面国际化（dataTable.* 751 键）、v9 排序表头自动接线
- bundle 基线 2467kB → 2603kB（admin 收件箱/恢复码/会话管理等功能增量，无新依赖）
- 硬编码路由收敛到 `ROUTES` 常量（invite-member/logout-all/notifications/blog 等）
- `.env.example` 补齐 CONTACT_EMAIL/APP_VERSION/VERBOSE_LOGGING

### Fixed

- webhook events action 补 admin 守卫（防绕过入口越权读取）
- 年付节省金额浮点精度取整；三页面面包屑改用 common 命名空间（修复 `dashboard.dashboard` 缺键）
- RECOVERY_CODE_COUNT 移出 use server 文件；recovery action node:crypto 改动态导入（修客户端代理导出分析失败）
- standalone 输出条件化（DOCKER_BUILD 门控）
- 迁移 011 补 profiles lower(email) 函数索引（EXPLAIN 复审发现 Seq Scan）

## [0.3.0] — 2026-08-23

### Changed（大版本升级专项）

- **Next.js 15 → 16**：Turbopack 构建默认化、middleware→proxy 约定迁移、eslint-config-next 16 原生 flat config、favicon.ico RGBA 问题修复、react-hooks/purity 合规
- **Tailwind CSS 3 → 4**：`@tailwindcss/postcss` 替代双插件、`@config` 桥接既有 JS 配置、移除 autoprefixer
- **TanStack Table 8 → 9**：经官方 `useLegacyTable` 桥迁移（v8 API / v9 内核），原生 features API 列为后续任务
- **lucide-react 0.x → 1.x**：品牌图标移除 → 内联 GithubIcon SVG 组件
- **zod 3 → 4**：error.errors → error.issues 迁移
- eslint 复杂度门禁（≤15 报错，存量文件显式豁免登记）
- Bundle 基线门禁适配 Turbopack 输出（客户端静态资源总量 2467kB）

### Added

- Profiles Repository 数据访问层试点（/api/user 与 inviteMember 已收口）
- ActionResult 判别联合类型 + notifications Action 迁移试点
- 审计日志 CSV 导出（feature flag 门控）
- 通知"全部标为已读"（Server Action + 双语翻译键）
- Webhook 事件日志表迁移（010_webhook_events.sql，待应用）
- skip-to-content 无障碍链接
- 索引复审清单、环境/Staging 规范、API 路由文档、ADR ×4、邮件模板设计、Sentry 告警指南
- 依赖健康报告脚本（pnpm dep:health）、Agent 索引一致性校验

## [0.2.0] — 2026-08-23

### Added

- **Playwright E2E 冒烟测试**（8 用例：营销页/认证流/Mock dashboard）并进 CI 独立 job
- **组件测试基础设施**（jsdom + Testing Library 双项目结构）+ CheckoutButton / RemoveMemberButton / InviteMemberForm 共 10 个用例
- **覆盖率阈值门禁**：核心逻辑 statements/functions/lines ≥90%、branches ≥78%
- **Middleware 路由守卫单测**（7 用例）
- **Stripe webhook 纯函数测试**（mapStatus/mapPlan，10 用例）
- **CodeQL 安全扫描** + **gitleaks 密钥扫描** + **Dependabot** 自动依赖跟进
- **i18n 翻译对称性 CI 校验**（`scripts/check-locales.js`，733 key 双语对齐门禁）
- **Agent 体系补全**：新增 10 号提交与发布管理 Agent（编码→审查→提交→部署角色链闭环）

### Changed

- **默认语言改为英文**（应用 `defaultLocale=en`；文档站英文提升为根路径，中文移至 `/zh-CN/`）
- CSP 安全头新增（覆盖 Supabase/Sentry 域名），加 Permissions-Policy，移除废弃的 X-XSS-Protection
- 数据通道约定入 CLAUDE.md：写操作走 Server Actions，API Routes 仅限外部回调
- Stripe webhook 移除内存 rate limit（防事件重试 429 丢失），纯函数抽离至 `lib/stripe/webhook-mappers`
- 文档站首页恢复 VitePress 标准布局，GitHub 占位链接修正为 Sun1090/IndieStack
- 依赖区间内小版本升级（Radix 全家桶、React 19.2、stripe 22.5 等），Stripe apiVersion 跟随 SDK 默认
- pnpm 固定 11.22.0（packageManager 字段 + Dockerfile corepack 对齐）
- engines.pnpm 提升 ≥11

### Fixed

- mapPlan 在 priceId 与环境变量同为 undefined 时误匹配为 pro 的边界 bug
- pnpm/action-setup 与 packageManager 版本声明冲突导致 CI 失败
- vercel.json 旧版 builds/public 字段被 Vercel 导入 API 拒绝；显式声明 outputDirectory=.vitepress/dist
- 文档链接指向已下线的旧文档站域名 → 更新为 indie-stack-docs-site.vercel.app
- 删除死路由 `/api/teams`（无调用方）、死 hooks ×5、零消费的 SupabaseProvider、未使用的 usehooks-ts 依赖
- Dockerfile 冗余 node_modules 复制与 next.config/package.json 多余复制
- CI 孤儿 docs artifact 上传步骤移除；PR 触发补 develop 分支

## [0.1.0] — 2026-07-19

### Added

- **Next.js 15 App Router** with Route Groups, Server Components, Server Actions
- **Authentication** — Supabase SSR auth with Email, GitHub, Google OAuth
- **Marketing site** — Landing page, Features, Pricing, About, Blog, FAQ, Changelog, Contact, Privacy, Terms
- **Dashboard** — Overview, Analytics, Projects, Notifications, Integrations, Profile, Settings, Team management, Billing
- **Supabase integration** — PostgreSQL database with RLS, Realtime subscriptions
- **Sentry error monitoring** — Client, Server, and Edge runtime config
- **Stripe-ready billing** — Subscription tiers (Free, Pro, Enterprise) with checkout flow
- **Team management** — Multi-tenant with roles (owner, admin, member), invites
- **Responsive UI** — shadcn/ui components, dark/light mode, mobile-first
- **CI/CD** — GitHub Actions workflows for linting, type-checking, building, deploying to Vercel
- **Alibaba Cloud OSS** integration for file storage
- **Appark APM** instrumentation
- **i18n-ready** architecture with zh-CN default locale
- **VitePress documentation site** — Bilingual (zh-CN/en) standalone documentation website with dark/light theme at `docs-site/`
- **Docker compose** — Local PostgreSQL development environment

### Technical Details

- TypeScript strict mode across the entire codebase
- Zod validation for all forms and API inputs
- Server Components by default, client components only where interactivity is needed
- Row Level Security on all database tables
- Auto-creation of profiles and personal teams on user signup
- Security headers (X-Frame-Options, XSS Protection, CSP-ready)
- Rate limiting infrastructure via `api_usage` table
- Image optimization with AVIF/WebP support

### Notes

- `docs/` directory contains complete architecture, setup, deployment, and configuration documentation
- Open `docs-site/` to view the interactive VitePress documentation website: `cd docs-site && pnpm dev`
