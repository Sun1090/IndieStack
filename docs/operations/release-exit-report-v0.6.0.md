# v0.6.0 退出报告 / Exit Report

- 报告日期（UTC）：2026-09-22
- 核对基线：`main` 提交 `75fae73`（本报告分支的父链），`package.json` 版本 `0.11.0`
- 核对范围：`docs/roadmap-0.6.0.md` 的 100 项任务池与 6 条退出标准
- 核对方式：**逐条读代码、门禁与执行记录**，不采信 roadmap 文件里的 `（完成：…）` 标注与开头那段
  进度汇总。每条结论给出可复现来源（文件路径、`pnpm check:*`、CI run、演练记录）。
- 为什么现在才写：`.github/workflows` 里唯一的历史标签是 `v0.6.0`（`git tag -l` 只有一个结果），
  CHANGELOG 的 `[0.6.0] — 2026-09-12` 说明它当天就发了版，而 `docs/operations/release-gap-audit-v0.6.0.md`
  把 J09 明确记为「发布后生成」。也就是：**v0.6.0 在没有退出报告的情况下发布了**，本文件补上这份
  欠账，并顺带把任务池与代码的真实差距钉住。

## 结论

1. **任务池**：100 项中 **91 达成 / 7 部分达成 / 2 未达成**。未达成是 F01（Mock MFA 状态隔离）
   与 J08（发布后回滚演练）；部分达成集中在「接线做了、语义没做」与「文档没打标」两类。
2. **退出标准 1–5 达成，标准 6 只达成一半**：生产 smoke 在 v0.6.0 真跑过（6/6，含可核对的
   Actions run 与 artifact 指纹），但**回滚演练至今没有任何一次执行记录**——每个版本的
   `rollback-runbook-*.md` 的「演练记录」都是空模板。
3. **本次核对最重要的发现（P0，已另开 PR #59）**：摘要邮件在生产上对**几乎所有用户都不会投递**。
   `isDigestHour` 要求用户**本地小时恰好等于 8**（`src/lib/email-digest.ts:89-95`），
   而 `vercel.json` 把 `/api/cron/digest` 调度成 `0 9 * * *`——Hobby plan 每路径每天最多一次，
   所以只有**一个固定 UTC 时刻**。实测 `2026-09-22T09:00:00Z` 的本地小时：
   上海 17、东京 18、伦敦 10、纽约 5、洛杉矶 2，只有 `Atlantic/Cape_Verde`（UTC-1）是 8。
   E03 当时修的是「没人调度」，调度确实补上了，但**错峰门控让这次调度对绝大多数用户恒定不命中**，
   而跳过分支此前不计数：每轮在指标上表现为 `pulled=N, sent=0, groups=0, failed=0` 的「成功」。
   PR #59 加了 `cron.digest.deferred` 与对应告警规则，并把双语 docs-site 的反话改对；
   **投递语义怎么改仍是产品决策**（见「遗留项」第一条）。
4. **roadmap 文件与代码不符**：开头的进度汇总把 F 域整体记为已完成，而 F01 在代码里完全没落地、
   F02 的请求级 store 零消费者；另有若干条目**已达成却没有打标**（H01、A04 等）。文件已改为
   「收口 + 指向本报告」，历史快照文本不再逐条修订。

## 退出标准逐条核对

| # | 退出标准 | 证据（今日在 `main` 上复跑或从 Actions 取回） | 状态 |
| - | -------- | ---------------------------------------------- | ---- |
| 1 | `pnpm verify:build`、`pnpm test:e2e` 全绿，覆盖率 branches ≥ 90% | `pnpm verify:build` 退出码 0：188 文件 / 2,132 用例、Bundle 2845.7 kB（基线 2733.8 kB 内）、生产构建成功；`pnpm test:coverage` 实测 statements 96.95 / **branches 91.64** / functions 97.68 / lines 97.94，阈值来自 `vitest.config.ts`（91/90/93/92）；E2E 由 CI run `35681181712`（`main@75fae73`）的 shard 1 与 shard 2 全绿 | 达成 |
| 2 | CI、CodeQL、Secrets Scan 全绿，生产依赖无高危漏洞 | `main@75fae73` 四条 workflow 均 `completed/success`：CI `35681181712`、CodeQL `35681181671`、Secrets Scan `35681181693`、Security and configuration checks `35681181697`；`pnpm audit --prod` → `No known vulnerabilities found` | 达成 |
| 3 | Mock 测试可显式 reset，E2E 不依赖不可控的跨用例共享状态 | 有 Bearer 保护的 `/api/e2e/mock-reset`（`e2e/admin-contact-mfa.spec.ts` 断言其鉴权），但 MFA 状态仍是**进程全局**：`src/lib/mock/index.ts:123-124` 的模块级 `let` 加上 `MOCK_GLOBAL`（`globalThis.__indiestackMockCache__`）；请求级原语 `createMockRequestStore`（`src/lib/mock/store.ts`）除自身 3 条单测外**零消费者**；`playwright.config.ts` 默认 `workers: 1` 串行兜住 | 部分达成 |
| 4 | 上传、通知、MFA 关键路径均有失败/重试/权限边界测试 | `e2e/uploads.spec.ts`（5 用例 / 18 断言：类型不支持、超限、注入失败→重试写回、进度与取消）、`e2e/mail-flow.spec.ts`（`failNext` 注入 → `email_attempts` 累加、`worker_runs.failed>0`、达上限进死信可查）、`e2e/webhook-events.spec.ts`（缺失/无效签名、重复 event id 幂等）、`e2e/admin-contact-mfa.spec.ts`（MFA 开启→验证、reset 鉴权）；权限面由 `pnpm check:rls` 与 `check:supabase-security` 静态钉住 | 达成 |
| 5 | 数据库迁移、RLS、发布清单与 docs-site 章节同步完成 | `pnpm check:migrations`（33 个迁移 SHA-256 与 `supabase/migration-manifest.json` 全比对）、`pnpm check:migration-history`（本地栈 `33 local migrations applied`，与仓库一致）、`check:rls`（20 张 public 表 / 35 条生效策略均带 USING/WITH CHECK）、`check:release-docs`（`v0.11.0, 7 artifacts`）、`check:docs`、`check:provider-docs`（9 provider / 29 环境变量 × 2 份文档） | 达成 |
| 6 | 发布后 smoke 与回滚 runbook 已演练并记录结果 | **smoke 达成**：`docs/operations/production-smoke-v0.6.0.md` 记录 6/6 通过、目标 commit `16f3b75`、Actions run `34681676184`（今日用 `gh run view` 复核为 `completed/success`、headSha `16f3b756…`）、artifact `production-smoke-evidence`（id `10293909831`，SHA256 `21cb9feb…`）。**回滚未达成**：`rollback-runbook-v0.6.0.md:44-52` 的「演练记录」是空模板，v0.7.0–v0.11.0 各份同样为空；`docs/operations/drills/` 里只有两份真库数据演练脚本（`account-erasure.sql`、`retention-cleanup.sql`），不是发布回滚演练 | 部分达成 |

> 标准 1 的数字是**当前 `main`** 的复跑结果，不是 `v0.6.0` 那个 commit 的构建证据。仓库没有保留
> 逐版本的 verify/coverage 归档，因此 v0.6.0 当时的覆盖率只能追溯到 CI 通过记录，不能追溯到具体百分比。

## 任务池 100 项处置

状态口径：**达成** = 交付物存在且已接线（门禁进 `check-all.sh` 或 workflow、代码有真实调用方、
文档记录与代码一致）；**部分达成** = 交付物存在但覆盖面或语义有缺口；**未达成** = 找不到交付物。

### A. 对象存储与上传（8 达成 / 2 部分）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| A01 | 达成 | `src/lib/storage/index.ts` 的 `StorageDriver`（provider/capabilities/signedUrl/remove，Supabase + OSS 双驱动）+ `index.test.ts` | - |
| A02 | 部分达成 | `src/lib/actions/uploads.ts`（13 案单测：未登录/超限/回写失败/清理）与 `src/app/api/uploads/{avatar,project-cover}/route.ts` 共用 `src/lib/uploads/service.ts` | 两个 Server Action **无任何页面或组件调用**，线上路径是 Route Handler；标注写「统一经 Server Actions」与代码相反（孤岛入口，双份维护面） |
| A03 | 达成 | `ALLOWED_IMAGE_TYPES`（png/jpeg/webp）+ `AVATAR_MAX_BYTES` 2 MB（`src/lib/storage/index.ts:28`）；`buildObjectKey` 拒绝路径穿越（`index.test.ts:354`） | - |
| A04 | 达成 | `src/lib/storage/index.ts:167` 的 `buildObjectKey`，`avatars/{userId}` / `covers/{projectId}`（`uploads/service.ts:218,315`），迁移 `024` + `storage-policies.test.ts` | 代码齐备但条目无标注（文档落后于实现） |
| A05 | 达成 | `validateSignedUrlExpiry`（1 秒下限 / 7 天上限，`storage/index.ts:29-36`），`index.test.ts:144-148` 断言 0 / 60.5 / 小数被拒 | - |
| A06 | 达成 | `src/lib/providers/diagnostics.ts` + `scripts/lib/provider-doctor.js`（`pnpm provider:doctor`） | 运维命令，按设计不进 `check-all.sh` |
| A07 | 达成 | 配置不完整时强制回退 Supabase（`storage/index.ts:107,154-160`），`getStorageDriver()` 上报实际驱动 | - |
| A08 | 达成 | `src/components/forms/avatar-upload-form.tsx` 挂在 `dashboard/profile/edit`，`/api/uploads/avatar` + 测试，`e2e/uploads.spec.ts` | - |
| A09 | 部分达成 | 封面端到端在：`src/components/dashboard/cover-upload-form.tsx`（POST `API_ROUTES.uploads.projectCover`）挂在 `dashboard/projects/[id]/page.tsx:222` | 条目里的「附件」全仓无实现（只有测试夹具里出现过 `project-attachments` 字样） |
| A10 | 达成 | 迁移 `033`（引用判定 + 孤儿清单）+ `032` 的 prune，`src/lib/uploads/{erasure,orphan-audit}.ts`、`pnpm audit:storage-orphans`、`e2e/account-deletion.spec.ts` | 031 之前从未落元数据的存量对象需 provider 侧 `list()` 差集（已在代码注释登记） |

### B. 推送与通知统一（10 达成）

| # | 状态 | 证据 |
| - | ---- | ---- |
| B01 | 达成 | `src/app/manifest.ts:11-13`（scope/lang/orientation） |
| B02 | 达成 | `public/sw.js`（install/activate 控制、push payload 解析、notificationclick） |
| B03 | 达成 | 迁移 `020_push_subscriptions.sql`（唯一约束 + RLS + 索引 + updated_at 触发器） |
| B04 | 达成 | `src/lib/actions/push-subscriptions.ts` 的 subscribe/unsubscribe，被 `push-notification-form.tsx` 调用 |
| B05 | 达成 | `src/components/forms/push-notification-form.tsx`（`Notification.requestPermission`）挂在 `dashboard/settings` |
| B06 | 达成 | `src/lib/push-provider.ts`（真实 web-push/VAPID，404/410 归类）+ `push-notify.ts` 扇出与撤销 + `mock/push-transport.ts` |
| B07 | 达成 | `src/lib/notification-prefs.ts` 的 `shouldSendEmail/shouldSendPush` 单一矩阵，邮件与两条 push 路径均引用 |
| B08 | 达成 | 迁移 `021_notification_idempotency.sql` 的 `unique(user_id, idempotency_key)`，键贯穿两个 provider |
| B09 | 达成 | `src/lib/push-retry.ts`（`PUSH_MAX_ATTEMPTS` → dead/revoked + `push.delivery.dead`），`/api/cron/push-retry` 已调度 |
| B10 | 达成 | `e2e/push-retry.spec.ts`（10 用例 / 30 断言）+ `e2e/notifications-realtime.spec.ts` + 迁移 `025` |

### C. MFA 与认证安全（10 达成）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| C01 | 达成 | `src/lib/mock/index.ts:1390-1500` 的 enroll/challenge/verify/unenroll 状态机 + `mock.test.ts:329` | 隔离度见 F01（进程全局，非请求级） |
| C02 | 达成 | `e2e/admin-contact-mfa.spec.ts:104`「开启 → 验证后显示已启用」 | - |
| C03 | 达成 | `src/app/auth/mfa/page.tsx` + `login-form.tsx:92,182` + **挑战页自身测试 `src/app/auth/mfa/page.test.tsx`（13 条，2026-09-22 由 v0.12.0 的 C03 补上）** | 仍缺一条端到端走 `/auth/mfa` 的 E2E |
| C04 | 达成 | `src/lib/repositories/mfa-recovery-codes.ts`（listUnused/replace/consume）+ 两个 action 测试 | - |
| C05 | 达成 | `hashRecoveryCode`（SHA-256，`actions/recovery-codes.ts:26`）+ 迁移 `013`/`022` | 明文只在 UI 单次展示，这一点无门禁守护 |
| C06 | 达成 | `src/lib/auth/errors.ts:40-43` + `actions/login-attempts.ts`（邮箱 5 次 / IP 20 次每 15 分钟）+ `rate-limit.ts` | - |
| C07 | 达成 | 迁移 `018_session_devices.sql`、`settings/page.tsx:56-68,146-165`、`actions/sessions.ts` 的 `recordCurrentSession` | 仅单测，无 E2E |
| C08 | 达成 | `revokeSession` + 三个按钮组件（当前设备 / 其他设备 / 全局登出） | 三个按钮组件无组件级测试 |
| C09 | 达成 | `actions/audit.ts:59-60`（`auth.mfa_verified` / `auth.recovery_redeemed`）+ `e2e/audit-logs.spec.ts` | - |
| C10 | 达成 | `pnpm check:rls` 实跑通过；`rls-coverage.ts:54` 明列 `mfa_recovery_codes` 拒绝客户端读写；`check:supabase-security` | - |

### D. 多语言与可访问性（10 达成）

| # | 状态 | 证据 |
| - | ---- | ---- |
| D01 | 达成 | `src/lib/i18n/glossary.ts` + `pnpm check:glossary`（与 `docs/architecture/10-i18n.md` 术语表逐项双向相等） |
| D02 | 达成 | `src/lib/i18n/translation-values.ts` + `check:locales`（值审计：汉字要求、内部标识符形状、`UNTRANSLATED_VALUE_ALLOWLIST` 逐项登记理由） |
| D03 | 达成 | 同上（扫描覆盖 `messages/` 全部命名空间含 dashboard，数组按下标展开） |
| D04 | 达成 | `check:i18n`（854 个静态键）+ `src/lib/i18n/dynamic-keys.ts` 与 `check:dynamic-keys` 补掉动态键盲区 |
| D05 | 达成 | `locale-switcher.tsx` 写 `app-locale` cookie、`src/i18n/request.ts` 读、`<html lang>` 跟随，`localePrefix: "never"` |
| D06 | 达成 | `e2e/smoke.spec.ts:112-128`（cookie + `lang` + 中文首屏文案出现且英文原文消失） |
| D07 | 达成 | `src/lib/i18n/action-errors.ts` + `check:action-errors`（键存在 / 各 locale 不得逐字相同 / 禁裸渲染） |
| D08 | 达成 | `src/lib/styling/direction.ts` + `check:direction`（应用层 0 处物理方向类）+ `10-i18n.md` 的 D08 评估小节 |
| D09 | 达成 | `e2e/keyboard.spec.ts`（6 用例 / 27 断言，`toBeFocused`、`aria-expanded`、可访问名） |
| D10 | 达成 | `src/lib/ui/a11y-rules.ts` + `check:a11y`（重写后含失败封闭与计数器）+ `e2e/a11y.spec.ts`（5 公共页 + 9 已认证页跑 axe） |

### E. 可观测性与运维（8 达成 / 2 部分）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| E01 | 达成 | `src/lib/appark-config.ts` 采样解析 + `appark.ts:49-66`（0 静音、非法值回退并告警） | 无专用门禁，靠 env 校验与单测 |
| E02 | 达成 | `src/lib/trace-id.ts` + `src/proxy.ts` + `api-log.ts`；`check:trace-coverage` 进 CI | - |
| E03 | 部分达成 | 接线达成：`CRON_WORKERS` 注册表 + `vercel.json` 五条调度 + `check:cron-contract`（3 worker / 15 指标） | **语义未达成**：digest 错峰门控与每天一次的调度不兼容，除 UTC-1 外无人被投递；本次核对发现，可见性已在 PR #59 修，产品决策待做 |
| E04 | 达成 | `EMAIL_NOTIFICATION_TYPES` 单源同时供拉取与 `email.backlog`；`notifications.test.ts` 与 digest 路由测试钉边界 | - |
| E05 | 达成 | `src/lib/observability/storage-metrics.ts` 被 `uploads/service.ts` 与 `storage/index.ts` 引用（含「provider 成功但回写失败」的用户可见失败） | - |
| E06 | 达成 | `provider-metrics.ts` 的 `provider.fallback` + 缺失变量签名去重；未配置路径立即产出 `reason=not-configured` | - |
| E07 | 达成 | `ops-metrics.ts` 全部终态计数样本；`alert-thresholds.test.ts` 把文档阈值（500 / 连续 3 轮）与代码常量钉死 | Sentry 侧规则本身是否已配置无法本地验证（无 IaC） |
| E08 | 达成 | `/api/health` 的 required/optional 分级与 `configured/reachable/status`，非 ok 返回 503 | - |
| E09 | 部分达成 | 真库演练已有两份脚本并留了记录：`docs/operations/drills/retention-cleanup.sql`（14 条断言）、`account-erasure.sql`；另有 `docs/db/retention.md` 的三条演练记录（含关掉 mock 的整链路实跑与失败注入） | 部署回滚、凭据轮换、provider、incident 演练均未做；云端同型演练需 Dashboard/直连凭据 |
| E10 | 达成 | `.github/workflows/health-check.yml`（手动 + 每日保活）→ `scripts/lib/health-probe.js`（3 次重试、`200 && status=ok && ready!==false`） | 真实生产 URL 的通过记录只能取 Actions 端 |

### F. 测试基础设施（7 达成 / 2 部分 / 1 未达成）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| F01 | **未达成** | — | MFA mock 状态仍是进程全局（`src/lib/mock/index.ts:123-124` + `MOCK_GLOBAL`）；没有任何 MFA 隔离测试。roadmap 开头写「F01–F10 已完成」与代码相反 |
| F02 | 部分达成 | `src/lib/mock/store.ts` 的 `createMockRequestStore` + 3 条单测（含跨 scope 不共享） | 原语**零消费者**：client/query/auth 构造函数仍默认 `MOCK_GLOBAL`，第二阶段未开工 |
| F03 | 达成 | `docs/testing.md:231-241` 记录评估结论（运行时不引入 file-backed fixture，离线快照的脱敏/TTL/artifact 前置条件） | 纯评估，与条目口径一致 |
| F04 | 部分达成 | `playwright.config.ts:11,19-20` 的 `PW_FULLY_PARALLEL` 显式开关（默认仍 `workers: 1`） | 「31/31 通过」是一次历史实验，仓库里没有可复跑的并行基线 |
| F05 | 达成 | `e2e/webhook-events.spec.ts`（5/22：签名缺失与无效、skipped 落库、重复 event id、Bearer、mock 关闭） | - |
| F06 | 达成 | `e2e/audit-logs.spec.ts`（3/20：详情字段 + MISSING_MESSAGE 守卫 + 过滤） | - |
| F07 | 达成 | `e2e/uploads.spec.ts`（5/18）+ `src/app/api/e2e/mock-upload/route.ts` 的失败注入 | - |
| F08 | 达成 | `email-send.ts` 导出端点/发件人常量并支持 `RESEND_API_URL` 覆盖，12 条契约单测（缺 key 不发请求、非 2xx 映射、网络错不重试） | - |
| F09 | 达成 | `vitest.config.ts:30-35` 阈值 91/90/93/92；今日实测 branches 91.64% | roadmap 里的「886/984 = 90.04%」基数已过期（当前分支总数 3,579） |
| F10 | 达成 | `ci.yml` 独立 `Unit Tests` job 跑 `pnpm test:coverage` 并上传 artifact，E2E 分片各自上传 report | - |

### G. UI 系统与 Tailwind（10 达成）

| # | 状态 | 证据 |
| - | ---- | ---- |
| G01 | 达成 | `globals.css` 的 `@theme` 动画与 `@utility container`；`src/lib/tailwind/native-theme.ts` + `check:tailwind`（实跑 315 文件、无 `@config`） |
| G02 | 达成 | `src/lib/design/tokens.ts` 单一事实来源 + `check:tokens`（实跑报 40 个登记 token） |
| G03 | 达成 | `shared/form-field.tsx`（5 原语）+ `native-select.tsx` + `check:fields`（133 文件，禁 `RAW_SELECT` 等） |
| G04 | 达成 | `PageLoading` / `EmptyState` / `ErrorState` + `check:states`；`page-loader.tsx`、`loading-state.tsx` 已删除且门禁禁复活 |
| G05 | 达成 | `src/lib/theme/theme.ts` 收口 `ui-theme` 与解析规则，被 `app/layout.tsx` 与 `theme-provider.tsx` 共用；13 单测 + `e2e/theme.spec.ts` |
| G06 | 达成 | `e2e/responsive.spec.ts`（375/768/1280 无横向溢出）+ `MobileDashboardNav` |
| G07 | 达成 | `e2e/keyboard.spec.ts` + 4 处 `<main id="main-content" tabIndex={-1}>` + `check:a11y`/`check:direction` |
| G08 | 达成 | `src/lib/uploads/client.ts` 的 `xhr.upload.onprogress` + abort，`useFileUpload` 供头像与封面两个表单，`e2e/uploads.spec.ts` 断言进度条与取消归零 |
| G09 | 达成 | 迁移 `025_notifications_realtime.sql` + `notifications-live.tsx`（`user_id=eq.` 过滤、120 ms 去抖、`aria-live`） |
| G10 | 达成 | `playwright.visual.config.ts`（1440×900、`maxDiffPixelRatio: 0.001`）+ 4 张 `-linux.png` 基线，CI 在 E2E 后执行 |

### H. 数据库与安全（10 达成）

| # | 状态 | 证据 |
| - | ---- | ---- |
| H01 | 达成 | 迁移 `020`/`026` + `repositories/push-subscriptions.ts` 真实读写 + `push-retry` 与 cron 路由 + `e2e/push-retry.spec.ts`（条目缺标注） |
| H02 | 达成 | 迁移 `031`/`033`、`repositories/upload-objects.ts`、`uploads/checksum.ts`、`docs/db/upload-metadata.md` |
| H03 | 达成 | `pnpm check:rls` 实跑通过并输出「20 张 public 表 / 35 条生效策略均带 USING 与 WITH CHECK，每张表已分类」 |
| H04 | 达成 | `src/lib/security/admin-client-boundary.ts`（TypeScript AST 级 inventory）+ `check:supabase-security` 实跑：32 个已分类 service-role 调用点 |
| H05 | 达成 | `src/lib/security/storage-policies.ts`（22 测试 / 30 断言）+ `docs/db/storage-policy-audit.md` + 迁移 `024` |
| H06 | 达成 | 迁移 `030` 的 `claim_webhook_event()` 原子占位 + 仓储与 mock 双侧镜像 + `docs/db/webhook-idempotency.md` |
| H07 | 达成 | `docs/db/index-review.md` 以 20 万行真实 `EXPLAIN ANALYZE` 定案；仓储默认不发 `count:"exact"` |
| H08 | 达成 | 迁移 `032`（`erase_user_data` + 三条保留期）、`src/lib/privacy/data-policy.ts` 双向契约；**并且保留期现在真的在执行**：`/api/cron/retention` 每天 05:00 UTC 逐个调用同一批迁移函数，已在本地真库演练成功路径与失败隔离（`docs/db/retention.md`） |
| H09 | 达成 | `check:migrations`（33 个迁移内容比对）+ `check:migration-history`（活库历史对齐） |
| H10 | 达成 | `check:security` 拆成纯策略模块 + 单测，覆盖 env 清单、workflow 最小权限、gitleaks/CodeQL/Dependabot 配置漂移 |

### I. 文档、发布与开发体验（9 达成 / 1 部分）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| I01 | 部分达成 | `docs-site/{,zh-CN/}email.md` 存在且大部分与代码一致 | 两份文档都写着「仓库中的 Vercel cron 没有调度 digest 路由」（E03 后已不成立），英文版另说「逐小时外部调度」与中文版「每天 09:00 UTC」互斥。已在 PR #59 按代码事实改写 |
| I02 | 达成 | `docs-site/{,zh-CN/}storage.md`，引用的迁移 `024` 与两个指标模块均存在 | - |
| I03 | 达成 | `docs-site/{,zh-CN/}web-push.md`，迁移 `020`/`026` 存在，双语逐段对应 | - |
| I04 | 达成 | `docs/adr/adr-001..014` + `check:adr` 进 CI | - |
| I05 | 达成 | `check:changelog`（`src/lib/changelog/parse-changelog.ts`）+ `check:release-docs` | - |
| I06 | 达成 | `.github/RELEASE_CHECKLIST.md` 由 `check:release-docs` 按版本读取 | - |
| I07 | 达成 | `docs-site/{,zh-CN/}mock.md` + `docs/architecture/13-mock-system.md` + `check:mock-docs`（18 张表） | - |
| I08 | 达成 | `src/lib/providers/diagnostics.ts` + `docs-site/{,zh-CN/}provider-diagnostics.md` + `check:provider-docs` | - |
| I09 | 达成 | `docs-site/{,zh-CN/}testing.md` + `src/lib/testing/test-matrix.ts` + `check:test-matrix` | 文档按既有约定不再写易漂移的用例条数 |
| I10 | 达成 | `docs/operations/migration-rollback-runbook.md` + `check:migration-runbook` | 「演练记录」空白属 J08 |

### J. 质量与发布（9 达成 / 1 未达成）

| # | 状态 | 证据 | 缺口 |
| - | ---- | ---- | ---- |
| J01 | 达成 | `verify:build` = `check` + `test` + `check:bundle` + `build`，`.husky/pre-push` 强制同一口径；CI 的 `Lint & Type Check` job 逐个执行 32 条 `check:*`（等价于 `check:all`），`Build` job 跑 `pnpm build` + `node scripts/check-bundle.js` + `node scripts/check-perf.js` + `check:a11y`，`Unit Tests` 跑覆盖率，`E2E (Playwright)` 分片跑 `test:e2e` | `verify:build` 这条**聚合命令名**不在 workflow 里（按组件拆开执行），`check:gates` 以豁免表如实登记这一口径 |
| J02 | 达成 | CI E2E 为 `[1, 2]` shard matrix，独立 dev server、内部单 worker，配置回归测试锁住分片与串行 | 分流条数由运行时决定，按约定不写进文档 |
| J03 | 达成 | 覆盖率拆到独立 job 与静态门禁并行，E2E 缓存 Playwright browsers，PR 并发取消，`check:workflows` 校验拓扑 | - |
| J04 | 达成 | `check:codeql` 固化 analyzer/套件/SARIF 契约 + `docs/operations/codeql-alert-triage.md` | 真实告警列表需 GitHub 权限 |
| J05 | 达成 | `check:secrets-scan` 固化 gitleaks 强度与 allowlist 审计 + 泄露响应 runbook | 历史扫描结果需 runner |
| J06 | 达成（限 v0.6.0） | `production-smoke-v0.6.0.md`：6/6 通过、commit `16f3b75`、run `34681676184`（今日复核 `success`）、artifact 带 SHA256 | v0.7.0 / v0.8.0 / v0.9.0 记录仍为「未执行」，v0.11.0 多数行待填（缺 Vercel build 配额与隔离账号） |
| J07 | 达成 | `check:release-tag` 要求 tag 与 `package.json` 一致、CHANGELOG 有非空版本章节，`release.yml` 用 `--notes-file` | - |
| J08 | **未达成** | — | 没有任何一次回滚演练记录：v0.6.0–v0.11.0 的 rollback runbook「演练记录」全为空模板；`docs/operations/drills/` 只有两份数据层演练脚本 |
| J09 | 达成 | 本文件即交付物（`docs/operations/release-exit-report-v0.6.0.md`） | — |
| J10 | 达成 | 下一版候选池按本次遗留项整理，落在 `docs/roadmap-0.12.0.md`（v0.7.0 早已发布，任务名里的版本号本身过期） | - |

## 与 roadmap 文本的矛盾（核对期间确认）

1. **F 域**：开头汇总写「F01–F10 已完成」，实际 F01 未做、F02/F04 只做了一半。
2. **A 域**：写「A01–A10 已完成」，实际 A02 的 Server Action 是孤岛入口、A09 的「附件」无实现；
   同时 A04 已完整达成却没打标。
3. **H01**：无标记，但迁移、仓储读写、表单、cron、E2E 全在——代码超前于文档。
4. **H08**：条目自述「pg_cron 未安装，所以 SQL 侧保留期实际不执行」在今日已过期，
   `/api/cron/retention` 每天执行同一批迁移函数，并在本地真库演练过成功与失败隔离两条路径。
5. **D02/D03**：写「剩余部分需要先建品牌/占位符白名单」，而 `UNTRANSLATED_VALUE_ALLOWLIST`
   已在通过的门禁里，两项实际已收口。
6. **易漂移数字**：F09 的「886/984 = 90.04%」、G02 的 token 数、G04 的文件数、G05 的 E2E 条数、
   H05 的单测条数均与当前实跑不符。roadmap 是**当时的快照**，按仓库既有约定不再逐个追改，
   以本报告与命令输出为准。

## 遗留项（按优先级，作为下一版候选池输入）

1. **digest 投递语义（P0，需产品决策）**：三选一——(a) 放宽窗口为「本地已过 08:00 或已等够一天」，
   保证送达但发送时刻偏离本地早晨，且固定 UTC 时刻会把西半球钉在凌晨；(b) 按时区带注册多条
   digest 路径（保住 08:00 语义，代价是平台 cron 名额与调度面）；(c) 接外部逐小时调度器
   （不改代码，引入仓库外运行依赖）。可见性已由 PR #59 解决：`cron.digest.deferred` + 告警规则。
2. **J08 回滚演练**：需要一次受控的生产版本切换演练并填 `rollback-runbook-*.md` 的记录；
   前置是 Vercel 部署权限（当前缺 build 配额与 token）。
3. **生产 smoke 复跑**：v0.7.0–v0.11.0 的执行记录待补，v0.11.0 的有副作用场景需隔离账号。
4. **F01/F02 mock 请求级隔离**：把 `createMockRequestStore` 真正接进 client/query/auth，
   再解锁 `fullyParallel`（F04）。
5. ~~C03 挑战页测试~~ **已关闭（组件层）**：`src/app/auth/mfa/page.test.tsx` 13 条覆盖缺 factor、
   输入门控、challenge/verify 失败与成功、redirect 消毒与恢复码分支；顺带发现并修掉了
   「抛异常时按钮永久停在 `...`」的缺陷（异常路径原先不复位 `loading`），并用变异核对确认那两条
   用例在还原生产代码后确实变红。剩一条端到端走 `/auth/mfa` 的 E2E 待补，它依赖 C01 的 Mock 隔离。
6. **A02 孤岛 Server Action**：确认是保留为编程入口还是删除（删除需同步 service-role inventory、
   错误码门禁与文档）。
7. **J01 的 CI 口径（核对后已关闭）**：客户端包体积基线 `check:bundle` 此前只在本地 `verify:build`
   生效，现已接进 CI 的 `Build` job（`node scripts/check-bundle.js`，复用同一次构建、不额外花时间），
   `check:gates` 里对应的 CI 豁免理由同步删除。剩下的只是 `verify:build` 这条**聚合命令名**仍按组件拆开跑。
8. **A10 存量对象差集**：031 之前从未落元数据的对象需要 provider 侧 `list()` 与数据库做差集，
   目前只能发现「有元数据行、无业务引用」的对象。

## 可复现验证

```bash
pnpm check:all            # 全部离线门禁（含 check:cron-contract / check:rls / check:supabase-security）
pnpm test:coverage        # 覆盖率（阈值见 vitest.config.ts）
pnpm audit --prod         # 生产依赖漏洞
supabase migration list --local   # 需本地栈在跑；确认 001–033 与仓库一致
pnpm check:migration-history
gh run list --branch main --limit 4      # CI / CodeQL / Secrets Scan / Security checks
gh run view 34681676184                  # v0.6.0 生产 smoke 的执行记录
```
