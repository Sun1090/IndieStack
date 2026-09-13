# IndieStack v0.6.0 Roadmap

> 主题：**可上传、可通知、可验证、可观测**
> 基线：v0.5.0（邮件全链路、OSS 基础接线、Passkey 试点、Admin/Contact/MFA E2E）→ 目标：v0.6.0
> 本文件先固定完整任务池与退出标准；每个任务实施时再拆成代码、测试、文档和发布子任务。
>
> **排期原则**：先补测试隔离与安全边界，再扩大外部能力；所有外部 provider 均保留 mock/fallback，生产开关默认安全关闭。

> **进度（2026-09-13）**：I01–I03 已完成（docs-site 邮件投递 0b94d8e、存储与 OSS 配置 e3a2ac1、Web Push f2e0070 三章 + 中英 configuration 同步）；I05 已完成；H09/H10 已完成（迁移漂移门禁、依赖高危与 secrets/scanner 配置漂移门禁）；C01–C10 已完成；F01–F10 已完成（F01 Mock MFA 状态隔离、F02 request-scoped mock store 第一阶段、F03 file-backed fixture 评估、F04 fullyParallel 隔离实验、F05 webhook events E2E、F06 audit logs 详情 E2E、F07 storage 上传失败/重试 E2E、F08 email provider contract tests、F09 coverage branch 90% 门禁、F10 CI artifact/coverage 告警清理）。A01–A10 已完成；B01–B10 已完成（Service Worker 生命周期、provider contract、服务端中转 action、上传白名单、通知 E2E）；E01 已完成（Appark 事件采样配置与诊断回退）；E02 已完成（`x-request-id` 契约 + 带 trace 的错误入口 + 覆盖门禁）；E03 已完成（修复 digest 未调度，新增 cron 调度/指标契约门禁与鉴权拒绝指标）；E04 已完成（邮件队列拉取与积压计数共用 `EMAIL_NOTIFICATION_TYPES`，空轮次记录真实耗时，`email.backlog` 每轮上报与阈值边界纳入测试）；E05 已完成（`storage-metrics.ts` 固化 provider 写入与请求终态两个指标，补齐「provider 成功但元数据回写失败」的用户可见失败盲区，驱动与领域层测试覆盖四个 provider/结果组合与三个终态）；
E06 已完成（`provider-metrics.ts` 固化回退指标与「缺失变量签名」去重闸门，`getStorageDriver()` 上报实际驱动；补齐 `RESEND_API_KEY` 缺失时失败率告警零样本的盲区，未配置路径立即产出 `reason=not-configured` 样本）；E08 已完成（health endpoint 依赖分级）；E10 已完成（手动触发的部署后 health check workflow 与本地 probe script）；G08/G09 已完成（真实上传进度/取消、通知 Realtime 与 025 迁移）；I04/I06–I10 已完成（ADR 治理、release checklist 与门禁接线审计、mock 指南、provider 诊断指南、贡献者测试矩阵、迁移回滚 runbook）；J02 已完成（E2E shard 策略）；J03 已完成（CI 并行与缓存优化）；J04 已完成（CodeQL 告警零回归）；J05 已完成（Secrets Scan 零回归）；J07 已完成（标签/Release Notes 自动化门禁）。其余任务按 M1→M2→M3→M4 推进。

## 任务池（100 项）

### A. 对象存储与上传（A01–A10）

1. A01 OSS provider 接口与能力矩阵（完成：统一 `StorageDriver` contract，暴露 provider/capabilities，并覆盖 Supabase signed URL/remove 能力）
2. A02 服务端中转上传 action（完成：`uploadAvatar`/`uploadProjectCover` 统一经 Server Actions 鉴权、读取、存储写入、数据库回写和缓存失效；覆盖未登录、项目不存在、团队角色、存储失败与回写失败）
3. A03 MIME/扩展名/文件大小白名单（完成：仅允许 PNG/JPEG/WebP；扩展名由 MIME 映射生成；头像限制 2MB；覆盖空文件、PDF、超限和路径穿越输入）
4. A04 对象 key 命名与租户边界
5. A05 签名 URL 生成与过期校验（完成：Supabase/OSS 统一签名 URL contract；过期时间限制 1 秒至 7 天，拒绝小数、零值、负值和超限参数）
6. A06 OSS 配置完整性诊断
7. A07 Supabase Storage fallback
8. A08 头像上传接入 profile
9. A09 项目封面与附件接入
10. A10 删除、孤儿对象清理与审计

### B. 推送与通知统一（B01–B10）

11. B01 PWA manifest 能力评估（完成：manifest 增加 scope/lang/orientation 安装能力元数据）
12. B02 service worker 生命周期策略（完成：`public/sw.js` 实现 install/activate 控制、push payload 解析、通知点击跳转）
13. B03 Web Push 订阅表迁移
14. B04 订阅注册/撤销 action
15. B05 通知权限与设置 UI
16. B06 Web Push provider 抽象（完成：`push-provider.ts` 使用真实 `web-push` 传输层，VAPID 鉴权、TTL/超时/urgency 契约、`configured` 安全降级与 404/410 归类；`push-notify.ts` 扇出投递并撤销失效端点；Push 失败不影响站内通知与邮件）
17. B07 邮件/Web Push 偏好统一
18. B08 通知去重键与幂等
19. B09 失败重试与死信统一
20. B10 通知链路 E2E

### C. MFA 与认证安全（C01–C10）

21. C01 Mock MFA factor 状态切换与测试
22. C02 MFA enrollment UI E2E
23. C03 MFA challenge 登录流程
24. C04 恢复码生成、轮换与消费
25. C05 恢复码安全存储与脱敏
26. C06 错误、过期、重试锁定策略
27. C07 会话设备列表与元数据
28. C08 单设备吊销与全局登出
29. C09 安全审计日志详情
30. C10 认证边界与 RLS 回归

### D. 多语言与可访问性（D01–D10）

31. D01 术语表与翻译贡献规范
32. D02 公共页面翻译完整性扫描
33. D03 dashboard 页面翻译完整性扫描
34. D04 next-intl missing-key build gate
35. D05 语言切换状态持久化
36. D06 语言切换 E2E
37. D07 表单错误消息双语覆盖
38. D08 RTL/长文本布局评估
39. D09 键盘导航与焦点回归
40. D10 自动化 a11y 门禁

### E. 可观测性与运维（E01–E10）

41. E01 Appark 生产采样配置（完成：`NEXT_PUBLIC_APPARK_SAMPLE_RATE` 事件级概率采样，默认 1、0 静音、非法值告警后回退 1；接入 env 与 provider 诊断、ADR/架构/双语配置文档，并有纯函数与运行时回归测试）
42. E02 request/route trace 关联 ID（完成：`src/lib/trace-id.ts` 固化 header 名与归一化/生成/解析契约，`src/proxy.ts` 解析上游 ID、注入请求头并回写放行与重定向响应头；新增 `logActionError` 与 `logApiError` 共用带 trace 的实现，16 个 Server Action 的裸 console 全部迁移；`pnpm check:trace-coverage` 扫描 Route Handler 与 Server Action 禁止裸日志、校验三个契约文件、空集合与过期豁免失败封闭）
43. E03 cron worker 指标结构化（完成：修复 `/api/cron/digest` 从未写入 `vercel.json` 导致生产摘要邮件不执行；`digest`/`push-retry` 统一上报可区分的 `cron.auth.rejected` 原因，digest 完成指标覆盖完整运行并补齐失败运行记录；`pnpm check:cron-contract` 双向校验调度表达式、路由方法、每轮指标与运维文档，平台保活任务显式豁免）
44. E04 邮件队列积压指标（完成：积压计数与拉取共用 `EMAIL_NOTIFICATION_TYPES` 单一事实源，新增仓库层测试锁定同一类型集合与死信过滤；空队列分支记录真实 `durationMs` 并同步 `cron.digest.completed`；`email.backlog` 每轮上报、恰好阈值不告警的边界纳入路由测试，运维与设计文档同步）
45. E05 OSS 上传成功率指标（完成：新增 `src/lib/observability/storage-metrics.ts` 作为指标名与维度取值的单一事实源；`storage.upload.completed` 覆盖 provider 写入，`upload.request.completed{operation,outcome}` 覆盖 provider 写入→元数据回写→回滚的完整链路，`cancelled` 单列不计入失败率；驱动层四个 provider/结果组合与领域层三个终态均有测试，运维告警表与双语 storage 文档同步）
46. E06 provider fallback 指标（完成：新增 `src/lib/observability/provider-metrics.ts` 固化指标名/原因取值与「缺失变量签名」去重闸门，`getStorageDriver()` 上报实际提供服务的驱动并只引用常量；补齐 `RESEND_API_KEY` 缺失时 `email.send.completed` 零样本的盲区（现在立即以 `reason=not-configured` 结束）；明确「OSS 四项全空」属默认驱动不告警；契约、闸门状态机、存储侧去重/重置/缺失集合变化与邮件未配置路径均有测试，运维告警表与双语 storage 文档同步）
47. E07 告警阈值与去重
48. E08 health endpoint 依赖分级（完成：required/optional 分级、configured/reachable/status 字段、Mock 安全降级、生产缺失/不可达返回 503、单元测试与 API 文档）
49. E09 运维 runbook 与故障演练
50. E10 发布后 health check 自动化（完成：`.github/workflows/health-check.yml` 手动触发部署后探测，`pnpm health:check` 复用同一校验逻辑；单次 10 秒超时、最多 3 次探测，要求 `200 + status=ok` 且 `ready` 不为 `false`，仅对网络错误/5xx/未就绪 body 重试）

### F. 测试基础设施（F01–F10）

51. F01 Mock MFA 状态隔离（本轮优先）
52. F02 request-scoped mock store 方案（第一阶段完成：`createMockRequestStore` 与隔离测试）
53. F03 file-backed E2E fixture 评估（完成：运行时暂不引入，采用 request-scoped store；离线快照需脱敏与临时目录隔离）
54. F04 恢复 fullyParallel 的隔离实验（完成：显式开关实验 31/31 通过但有 dev server 并发噪声，默认仍串行）
55. F05 webhook events E2E（完成：mock 表 webhook_events + Mock-only 查询/清理端点 + 签名缺失/无效 400、未知与 invoice 事件落库 skipped、重复 event id 幂等、Bearer 保护 4 类断言）
56. F06 audit logs 详情 E2E（完成：mock audit_logs 对齐真实 schema——entity_type/entity_id/metadata、bigint identity 自增、profile 默认 super_admin；audit 页面 action 徽标修复点号→冒号翻译键映射 （消除 MISSING_MESSAGE）+ 行 data-testid；E2E 覆盖详情字段渲染 / action 搜索与空态恢复 / Select 分组过滤 3 类断言；顺带修复 mock profiles 表 10 行重复 id（mock-user-001）导致的 React key 重复与关联错配）
57. F07 storage 上传失败/重试 E2E（完成：mock storage 层与 supabase-js 对齐——from().upload/getPublicUrl + failNext 注入计数；Mock-only /api/e2e/mock-upload 端点；E2E 覆盖空文件 fileRequired / PDF fileTypeUnsupported / 超 2MB fileTooLarge / 注入失败 uploadFailed→重试成功写回 avatar_url 4 类断言；修复 bodySizeLimit=2mb 与 AVATAR_MAX_BYTES 相等导致 >2MB 请求先触达框架上限、fileTooLarge 分支不可达的缺陷（抬至 3mb 留出 multipart 开销余量））
58. F08 通知 provider contract tests（完成：Resend 发送通道契约测试——`email-send.ts` 导出 `DEFAULT_RESEND_ENDPOINT/DEFAULT_EMAIL_FROM` 单一事实源并注释固化契约；新增 `email-send.test.ts` 10 用例锁定 默认端点与 `RESEND_API_URL` 覆盖、`Authorization: Bearer` + JSON 头、body 形状（from 默认/`RESEND_FROM` 覆盖、to 恒为数组）、缺 key 抛错且不发请求、2xx 静默 resolve、非 2xx 抛 `resend {status}: {detail}`、响应体读取失败仍保留状态码、网络错误原样上抛且 fetch 仅一次（不吞错不重试，重试/死信归调用方）；错误映射小加固（text() 失败 detail 置空）；与 E2E email-inbox/mail-flow 双端同构断言防漂移，为 B06 Web Push provider 抽象立契约样板）
59. F09 coverage branch 90% 评估（完成：基线 86.07% → 90.04%（886/984），vitest.config.ts branches 门禁 85→90；补测 email-notify.ts 边界（NEXT_PUBLIC_APP_URL 回落 localhost、profile 缺 notification_settings 兜底空对象、body/link 缺省置 null）、email-digest.ts 未知类型折叠标签回退、webhook-events repo（countWebhookEvents 成功/count null 回落 0/出错抛错、upsert payload 透传、listRecent data null 回落空数组）；4 项阈值 stmts 95.44/branch 90.04/func 96.51/lines 96.17 全过）
60. F10 CI artifact/coverage 告警清理（完成：`lint-and-type-check` job 的 Run tests 由 `pnpm test` 改为 `pnpm test:coverage`——CI 同步 enforce 覆盖率门禁（branches 90%），coverage/ 目录真实产出后 artifact 上传不再报空路径告警；验证 d2465a3 CI 4 job 全绿、test-coverage artifact 288KB 正常落盘、annotation 消除）

### G. UI 系统与 Tailwind（G01–G10）

61. G01 Tailwind v4 试点页迁移（完成：自持动画收口到 `@theme` 的 `--animate-progress-indeterminate` / `--animate-navprogress` token（`@keyframes` 内联进同一块），删除无引用的 `@layer utilities` 死代码（`.step`/`.step:before`）与裸 `@keyframes navprogress`；试点页 `bg-gradient-to-b`→`bg-linear-to-b`，`outline-none`→`outline-hidden` 扫过 4 个文件；新增 `pnpm check:tailwind` 构建门禁（`src/lib/tailwind/native-theme.ts` 纯规则 + `scripts/lib/tailwind-native-check.js`，7 类规则码含 `@config`/JS 配置/`tailwindcss-animate`/无 token 的 `@keyframes`/任意值动画/v3 重命名工具类，24 条单测），接入 `pnpm check:all` 与 CI；构建产物 CSS 复核 animation/`bg-linear-to-b`/`outline-hidden`/`w-[30%]` 均落盘，Linux 容器视觉基线 4 项无变化）
62. G02 design token 收口（完成：新增 `src/lib/design/tokens.ts` 单一事实来源——`DESIGN_TOKENS` 登记 39 个 token（含 `--success/--warning/--info` 三组语义色与 `--chart-1..5`），`@theme inline` 补齐 success/warning/info 与 chart 映射，深色块补 38 条覆盖；11 个业务文件从 Tailwind 原生调色板（`bg-green-500`/`text-amber-600`/`bg-red-500`…）迁到语义 token，暗色模式首次获得统一回退。新增 `pnpm check:tokens` 门禁（8 类规则码：根块/主题块缺失、token 缺根值或缺深色覆盖、映射缺失/悬空/未登记、原生状态调色板白名单外使用，`scripts/lib/design-token-check.js` 支持临时仓库根反例测试，共 28 条单测），接入 `pnpm check:all` 与 CI；`password-strength` / `notifications-live` 补语义类名单测；Linux 容器视觉基线 4 项无变化）
63. G03 shared form field 统一（完成：新增 `src/components/shared/form-field.tsx` 的 `FormField` / `FormFieldControl` / `FormFieldLabel` / `FormFieldDescription` / `FormFieldError`，由字段 context 统一注入 `htmlFor`/`id`、`aria-describedby`、错误 `aria-invalid` 与 `role="alert"`；原生下拉统一下沉到 `native-select.tsx`，并迁移 15+ 个应用层表单与 `forgot-password` / `reset-password` / `mfa` 等认证页。新增 `pnpm check:fields` 门禁（`RAW_SELECT` / `RAW_CONTROL_CLASSES` / `DIRECT_LABEL_IMPORT` 三类规则码，应用层 133 个文件扫描、排除 shadcn 基元与测试文件，8 条门禁单测 + 17 条原语单测），接入 `pnpm check:all` 与 CI；`[aria-invalid="true"]` 仅有统一可见红边；全量测试通过）
64. G04 loading/empty/error 状态统一（完成：新增 `src/components/shared/error-state.tsx` 的 `ErrorState`（`code`/`icon`/`title`/`description`/`action`/`size`/`role`，默认 `role="alert"`、无 `"use client"` 供服务端错误页复用），`page-loading.tsx` 重写为 `PageLoading`（`cards`/`dashboard`/`stats`/`list`/`spinner` 五种骨架 + `rows`）与 `LoadingIndicator` 单一来源，容器带 `aria-busy="true"`、骨架内嵌 `role="status"` 的 `sr-only` 加载文案并走 next-intl（不再硬编码中文）；删除零引用的重复加载组件 `page-loader.tsx` / `loading-state.tsx`。12 个 `loading.tsx` 中 3 个手写 Skeleton 全部收敛到 `PageLoading`（dashboard 首页 60 行手写骨架 → `variant="dashboard"`，admin → `stats`、admin/messages → `list`），10 处裸 `<p>` 空态改用带图标与语义的 `EmptyState`，4 个错误边界（`error` / `dashboard/error` / `global-error` / `not-found`）统一走 `ErrorState`，`data-table` 内联 loading/empty、`reset-password`、`auth/callback`、站点头像骨架一并迁移。顺带修掉 `faq-list` 硬编码英文 —— search placeholder 与 no-results 文案改为 props，双语各补 2 个 key。新增 `pnpm check:states` 门禁（`RAW_ROUTE_SKELETON` / `LEGACY_LOADER_MODULE` / `RAW_SPINNER` / `BARE_PLACEHOLDER` 四类规则码，扫描 132 个应用层文件与 14 个 `loading.tsx`，排除 `src/components/ui/**` 与测试；13 条门禁单测 + 14 条原语单测），接入 `pnpm check:all` 与 CI；全量测试通过）
65. G05 暗色模式回归（完成：`src/lib/theme/theme.ts` 收口存储键 `ui-theme` 与解析规则，根布局注入带 CSP nonce 的首屏阻塞脚本，暗色/浅色/系统三种偏好在 hydration 前即写入 `<html>` class 与 `color-scheme`，`localStorage`/`matchMedia` 分别兜底隐私模式与老浏览器；修掉 Provider 写 `ui-theme`、切换处读 `theme` 导致的持久化失效，system 模式改为监听系统变化实时跟随。新增 13 条单测与 `e2e/theme.spec.ts` 6 条 E2E，其中 4 条阻断 `/_next/static/**` 后用真实浏览器证明主题不依赖 React）
66. G06 移动端断点回归（完成：新增 `e2e/responsive.spec.ts` 覆盖 375/768/1280 三个断点，暴露并修复 375px 横向溢出（`@utility container` 手机 1rem / ≥640px 2rem）与 `hidden md:block` 侧边栏导致手机端导航不可达；页头断点 md→lg 并让汉堡菜单带 `aria-label`/`aria-expanded`/`aria-controls`，触屏隐藏快捷键入口；新增 `MobileDashboardNav`（ui/sheet 抽屉，跳转自动关闭），导航链接与角色/未读状态收口到 `dashboard-nav-links`、`use-is-admin`、`use-unread-notifications` 供桌面与移动共用。新增 18 条单测 + 11 条 E2E，Linux 容器视觉基线 4 项无变化）
67. G07 键盘与 screen reader 交互（完成：新增 `e2e/keyboard.spec.ts` 6 条基于角色/可访问名称的键盘回归，暴露并修复四处缺口——四处 `<main id="main-content">` 补 `tabIndex={-1}` 使跳过导航后焦点真正落到主内容；移动端页头菜单 Esc 关闭并把焦点交还汉堡按钮；仪表盘折叠按钮补齐 `aria-label`/`aria-expanded`/`aria-controls`、折叠后图标链接改用 `aria-label` 保留可访问名称；`?` 快捷键额外排除 contenteditable 与 `role="textbox"` 以及带修饰键的组合。新增 13 条单测（shortcuts-dialog 7 / site-header 4 / dashboard-sidebar +2），Linux 容器视觉基线 4 项无变化）
68. G08 上传组件进度与取消（完成：头像/封面改为同源 XHR Route Handler，`xhr.upload.onprogress` 显示真实百分比并支持 `abort()`；Action 与 Route 共用上传 service，保留鉴权、类型/大小/文件头校验、存储回滚与旧对象清理；补 service/client/request/Route/组件单测及头像 E2E 进度/取消闭环）
69. G09 通知中心实时刷新（完成：通知页客户端订阅 `public.notifications` 的 `INSERT` Postgres Changes，并按 `user_id=eq.<当前用户>` 过滤；120ms 合并 `router.refresh()`，连接中/已连接/离线状态有可访问文本并安全降级。`025_notifications_realtime.sql` 幂等加入 Realtime publication，RLS 继续限制订阅数据。新增组件单测、真实本地迁移重建和 Playwright E2E，覆盖错误用户过滤与无需 reload 的新通知展示）
70. G10 视觉回归基线（完成：新增 `playwright.visual.config.ts` 与 `e2e-visual/visual.spec.ts`，对首页/功能页/定价页/登录页 4 个公共页做 1440×900 全页截图，`maxDiffPixelRatio=0.001`；基线为 Linux Chromium PNG，在 `mcr.microsoft.com/playwright:v1.63.0-noble` 容器内生成，固定单 worker、UTC、浅色主题、Reduced Motion 并关闭动画/过渡，遮罩版权年份避免时间假失败；CI 在 E2E 之后自动执行 `pnpm test:visual`，失败时上传 `test-results/` 差异图；同时修正英文页脚 `&copy;` 未渲染为 © 的问题）

### H. 数据库与安全（H01–H10）

71. H01 Web Push migration
72. H02 upload metadata migration（完成：新增 `031_upload_objects.sql` 的 `public.upload_objects`（bucket/object_key/owner/byte_size/content_type/sha256/status，`(bucket,object_key)` 唯一，RLS 打开且零策略 + 收回 anon/authenticated 写权限，server-only）；上传服务改为 put → 落元数据 → 回写业务表，元数据失败即删对象回滚、旧对象确认删除后才标记 deleted；新增 `src/lib/repositories/upload-objects.ts` 与 `src/lib/uploads/checksum.ts`，mock 支持复合 onConflict，登记 service-role 清单与 server-only 表分类；唯一键 / CHECK / 触发器 / 级联删除与 3 角色身份矩阵（anon/authenticated 读 0 行、写被拒，service_role 可读写）均在本地 psql 验证，文档见 `docs/db/upload-metadata.md`）
73. H03 RLS 全表回归（完成：`pnpm check:rls` 修掉策略名按单词截断导致同表多策略互相覆盖的漏检，改为带引号的最终态归约 + 全表分类（有生效策略或显式登记 server-only），新表未分类直接失败封闭；新增 `src/lib/security/rls-coverage.ts` 与单测）
74. H04 service-role 最小权限审计（完成：新增 `src/lib/security/admin-client-boundary.ts`，用 TypeScript AST 清点每个 `createAdminClient()` 调用点并记录触达表/RPC/bucket/`auth.admin` 方法与授权证据；未登记调用点、越权表、未登记 bucket 均失败封闭，接入 `pnpm check:supabase-security`）
75. H05 storage policy 审计（完成：新增 `src/lib/security/storage-policies.ts`，bucket 集合从 `src/**` 的 `storage.from(...)` 发现、policy 集合从迁移最终态归约，交叉验证登记表/建行迁移/生效策略/`bucket_id`+`auth.uid()` 写收敛/公共读契约，7 类规则码全部失败封闭；20 条单测 + `docs/db/storage-policy-audit.md`（含真实数据库目录核对与 6 行身份矩阵））
76. H06 webhook 幂等约束（完成：`030_webhook_event_idempotency.sql` 新增 `claim_webhook_event()` 原子占位（`security definer` + 空 `search_path`，仅 `service_role`）与 15 分钟占位租约，唯一键由 `event_id` 收窄为 `(provider, event_id)`；Stripe 路由改成先占位、再处理、后落状态，重复投递回 200 且零副作用，副作用失败标记 `failed` 让重试可重新占位；E2E 从断言日志行数改为断言副作用本身不重放）
77. H07 审计日志索引复审
78. H08 数据保留与删除策略
79. H09 migration drift 检查（完成：`pnpm check:migrations` 离线校验迁移命名/编号连续/空文件/BOM/CRLF/结尾换行，并把每个迁移的 SHA-256 与提交的 `supabase/migration-manifest.json` 基线比对；`pnpm update:migrations-manifest` 只允许追加新增迁移，改写已基线化文件会被拒绝，避免用重跑基线掩盖历史篡改。新增 `pnpm check:migration-history` 只读比对本地 Supabase 迁移历史，对未应用迁移和数据库独有版本报错。纯函数 `src/lib/migrations/migration-drift.ts` 由 43 条单测覆盖，CLI 走 Node 原生 type stripping；静态门禁接入 `pnpm check:all` 与 CI，历史门禁因依赖 `supabase start` 不进离线聚合）
80. H10 依赖与 secrets 扫描门禁（完成：`pnpm check:security` 改为纯函数策略模块 + Node type-stripping CLI，检查 git 索引中的 `.env`/私钥文件、环境文件权限、客户端模块泄漏、workflow 最小权限，以及 gitleaks / CodeQL / security-config / Dependabot 的触发范围、action 版本和权限漂移；补齐旧清单遗漏的 `RESEND_API_KEY`、`VAPID_PRIVATE_KEY`，并对 `pnpm audit --json` 的 high/critical 计数 fail-closed。新增 54 条单测，门禁继续接入 `pnpm check:all` 与 CI）

### I. 文档、发布与开发体验（I01–I10）

81. I01 docs-site 邮件章节同步
82. I02 docs-site OSS 章节同步
83. I03 docs-site Web Push 章节同步
84. I04 ADR 更新与决策状态（完成：ADR-005/009 标记被 ADR-013/014 取代，ADR-010–013 状态统一，README 索引补齐至 14 篇；新增 `pnpm check:adr` 校验编号/状态/必要章节/索引/取代关系，21 条单测接入 `check:all` 与 CI）
85. I05 CHANGELOG 自动校验（完成：新增 `pnpm check:changelog`（`scripts/check-changelog.js` + `scripts/lib/changelog-check.js` + 纯函数 `src/lib/changelog/parse-changelog.ts`），校验 `[Unreleased]` 置顶且非空、版本标题 `## [x.y.z] — YYYY-MM-DD` 与日期合法性、版本降序与重复、每版本至少一个 `### 章节`、章节至少一个顶层条目、条目非空且不超过 2000 字符；行尾空白为 warning 不阻断。门禁接入 `pnpm check:all` 与 CI Lint & Type Check job，38 条单测覆盖解析与 CLI 退出码）
86. I06 release checklist v0.6.0（完成：`.github/RELEASE_CHECKLIST.md` 由 `pnpm check:release-docs` 按 `package.json` 当前版本校验产物与命令；新增 `pnpm check:gates` 把清单逐字引用的 workflow / job 名与打标签版本纳入回归——原「Lint&Type / Build / Docs / E2E / CodeQL / Secrets Scan」是自由文案，现已改写为可校验的真实名称`CI`（`Lint & Type Check` / `Build` / `Build Docs Site` / `E2E (Playwright)`）、`CodeQL`、`Secrets Scan`、`Security and configuration checks`）
87. I07 本地 mock 开发指南（完成：重写 `docs-site/mock.md` / `docs-site/zh-CN/mock.md` / `docs/architecture/13-mock-system.md`，把 18 张受支持表、进程级 `globalThis` 缓存 + `resetMockCache()` + `createMockRequestStore()` 状态模型、`src/proxy.ts` 接入点（不再写退役的 `middleware.ts`）、9 个 mock-only E2E 端点与 Playwright 注入环境变量写实；新增 `pnpm check:mock-docs` 按实现双向校验表名/端点并禁止旧错说法回流，抽取为空时失败封闭，28 条单测接入 `check:all` 与 CI）
88. I08 provider 配置诊断指南（完成：新增纯函数 `src/lib/providers/diagnostics.ts` 输出 9 个 provider / 28 个环境变量的 `ready`/`disabled`/`degraded`/`misconfigured`/`missing` 报告，`pnpm provider:doctor` 支持 `--json`/`--help` 且发现阻塞问题退出码 1，只报告变量名不泄露凭据；重写 `docs-site/provider-diagnostics.md` 与中文版并新增 `pnpm check:provider-docs` 按运行时注册表双向校验 provider id 与环境变量，文档源为空时失败封闭，24 条单测接入 `check:all` 与 CI）
89. I09 贡献者测试矩阵（完成：新增 `docs-site/testing.md` 与中文版 + 单一事实源 `src/lib/testing/test-matrix.ts`，把 11 个改动领域映射到覆盖路径与最小门禁集；新增 `pnpm check:test-matrix` 双向校验两份文档——领域必须登记、命令必须落在该领域行内、引用的 `pnpm <script>` 必须存在于 `package.json`（内置命令白名单除外），IO 层再确认覆盖路径仍存在，抽取为空失败封闭，14 条单测接入 `check:all` 与 CI）
90. I10 迁移回滚 runbook（完成：新增 `docs/operations/migration-rollback-runbook.md` 统一触发条件、决策树、前向修复优先、逆向风险、验证、审批与演练流程；`pnpm check:migration-runbook` 校验八个必备章节与关键事实、最新迁移标记同 manifest 一致、引用迁移真实存在、必备/引用脚本注册有效，抽取为空时失败封闭，20 条单测接入 `check:all` 与 CI）

### J. 质量与发布（J01–J10）

91. J01 lint/type-check/test/build 全链路门禁（完成：`pnpm verify:build` = `check` + `test` + `check:bundle` + `build`，`.husky/pre-push` 强制同一口径；CI 四个 job（`Lint & Type Check` / `Build` / `Build Docs Site` / `E2E (Playwright)`）覆盖全部组件。新增 `pnpm check:gates` 审计「门禁是否真的会跑」：每个 `check:*` 必须在 `check-all.sh` 与某个 workflow 中执行，或在豁免表登记仍成立的理由；借此发现并修复 `check:agents` / `check:docs` 只在本地聚合执行、CI 从未覆盖的缺口，28 条单测）
92. J02 E2E shard/串行策略复审（完成：CI `E2E (Playwright)` 改为 `[1, 2]` shard matrix，每个 shard 使用独立 dev server 且内部保持单 worker，避免共享 Mock 状态被并发修改；E2E 86 条按 46/40 分流并上传独立 artifact，4 条视觉基线仅在 shard 1 执行，新增配置回归测试锁定 shard、默认串行与 artifact 命名）
93. J03 CI 并行与缓存优化（完成：覆盖率测试从静态门禁 job 拆到独立 `Unit Tests` job 与静态门禁并行，`Build` / `E2E (Playwright)` 的 `needs` 仍只指向 `Lint & Type Check`，因此构建与 E2E 不再等覆盖率；E2E 新增 `~/.cache/ms-playwright` 缓存，键为 `playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}`，`install --with-deps` 保留以补齐系统依赖；触发 PR 的四个工作流新增 `concurrency` + `cancel-in-progress`，仅 PR 事件取消旧运行，main/develop push 与 schedule 保留；新增 `pnpm check:workflows` 校验作业 `runs-on`/`timeout-minutes`、`uses:` 固定 semver 标签或 SHA、`needs` 指向真实作业、PR 并发取消、禁止 `pull_request_target`、`pnpm <a:b>` 脚本真实存在以及 ci.yml 并行/缓存拓扑，28 条单测接入 `check:all` 与 CI）
94. J04 CodeQL 告警零回归（完成：新增 `pnpm check:codeql` 把「告警零回归」的前置条件固化为契约——`init`/`analyze` 同时存在且固定在 `github/codeql-action@v4`、语言 `javascript-typescript`、查询套件 `security-extended`、SARIF `category` 不漂移、`security-events: write` 与 `timeout-minutes` 保留、push 覆盖 `main`/`develop`、pull_request 覆盖 `main`、schedule 保持每周一次（退化为每日失败）；`paths`/`paths-ignore` 只认 触发器块，默认不允许排除任何路径，`paths` 白名单不得漏掉 `src`/`scripts`/`e2e`/`supabase`；配套 `docs/operations/codeql-alert-triage.md` 作为告警处置单一事实来源（阻断阈值 `security-severity >= 7.0`、5 个工作日内完成分诊、只允许 `false positive`/`won't fix`/`used in tests` 三种 dismissal 理由），门禁同时校验 runbook 章节与事实同源，44 条单测接入 `check:all` 与 CI；真实告警列表与基线对比需 GitHub `security-events: read` 权限）
95. J05 Secrets Scan 零回归（完成：新增 `pnpm check:secrets-scan` 把 gitleaks 工作流强度固化为契约——`gitleaks/gitleaks-action@v3`、`fetch-depth: 0` 全历史扫描、作业超时、`GITHUB_TOKEN` 接线与 `contents: read` 最小权限、push 覆盖 `main`/`develop`、pull_request 保留、自定义配置只能指向 `.gitleaks.toml`；`.gitleaks.toml` 存在时逐条审计 `[allowlist]`/`[[allowlists]]` 的 `paths`/`regexes`/`stopwords`/`commits`，默认不允许任何排除项，防止扫描结果被静默清空；配套 `docs/operations/secrets-leak-response-runbook.md` 统一 10 分钟首次响应、24 小时轮换、允许的 `false positive`/`used in tests` 理由与外部依赖，门禁校验 7 个必备章节与关键事实同源；48 条单测接入 `check:all` 与 CI；真实历史扫描结果仍需 GitHub/gitleaks runner 权限）
96. J06 production smoke test
97. J07 tag/release 自动化（完成：新增 `pnpm check:release-tag`，要求 `vX.Y.Z` 与 `package.json` 一致、CHANGELOG 存在带合法日期的非空版本章节，并从该章节生成 Release Notes；审计 `release.yml` 必须冻结安装、跑 `pnpm check:all`、以 `$GITHUB_REF_NAME` 校验标签、在创建 Release 前生成 notes 文件，且用 `gh release create --notes-file` 发布而不是 `--generate-notes`；顺带修正 `check:gates` 误把任意 workflow 的 `pnpm check:all` 当成覆盖聚合豁免门禁的接线判断，46 条标签策略单测 + 29 条门禁接线单测接入 `check:all` 与 CI）
98. J08 发布后回滚演练
99. J09 v0.6.0 退出报告
100.  J10 v0.7.0 候选池评审

## 里程碑

| 里程碑            | 内容                               | 任务域  |
| ----------------- | ---------------------------------- | ------- |
| M1 安全与测试基建 | Mock 隔离、MFA、RLS、E2E 稳定性    | C、F、H |
| M2 上传与通知     | OSS 上传、Web Push、统一偏好与回执 | A、B、G |
| M3 质量与观测     | 多语言/a11y、指标、告警、runbook   | D、E    |
| M4 发布收口       | docs-site、CI、smoke、tag/release  | I、J    |

## 退出标准

1. `pnpm verify:build`、`pnpm test:e2e` 全绿，且覆盖率 branches 不低于 90%。
2. CI、CodeQL、Secrets Scan 全绿，生产依赖无高危漏洞。
3. Mock 测试可显式 reset，E2E 不依赖不可控的跨用例共享状态。
4. 上传、通知、MFA 关键路径均有失败/重试/权限边界测试。
5. 数据库迁移、RLS、发布清单与 docs-site 章节同步完成。
6. 发布后 smoke 与回滚 runbook 已演练并记录结果。

> 执行记录（2026-09-06）：新增 `020_push_subscriptions.sql`，为 B03 提供 user/endpoint 唯一约束、RLS、索引和更新时间触发器；后续 B04 负责 action 接入。
