# IndieStack v0.5.0 Roadmap

> 主题：**邮件通道完善 + 对象存储接入 + 可观测性落地**
> 基线：v0.4.0（Admin 运营闭环 / 556 单测全绿 / audit 高危清零）→ 目标：v0.5.0
> 本文件定范围、里程碑与退出标准；单任务实现时再细分。
>
> **进度（2026-09-05）**：M1（A01–A05）、M2（B01–B03、C01–C03）、M3（D01–D03、E01–E03）
> 全部完成；M4：F03 完成，F01/F02/G01/H01 推进中（H01 发布基建本次落位）。

## 范围（in scope）

- **邮件通道完善**：摘要同类型合并与截断、失败重试计数与死信、高优先级类型实时单发、
  按用户时区错峰、营销邮件独立通道。
- **对象存储**：阿里云 OSS SDK 封装与上传收口（v0.4.0 仅 ADR），头像/项目封面接入。
- **可观测性**：Appark APM 接入（v0.4.0 仅 ADR）、cron worker 运行指标与队列积压告警。
- **认证安全**：WebAuthn/Passkey 从 ADR 推进到试点、登录限流策略全局收口。
- **性能与质量**：Tailwind v4 `@theme` 试点页、TanStack Query 缓存策略统一、
  E2E 补齐邮件/新页面流程、branches 覆盖率提升。

## 非范围（out of scope）

- 多语言新增语种（仅术语表维护）。
- 移动端原生能力（PWA 推送等留待 v0.6.0 评估）。
- 计费体系重构（Stripe 侧仅跟随 SDK 小版本）。

## 任务池

### A. 邮件通道完善（email-templates.md 设计债清偿）

| # | 任务 | 说明 |
|---|------|------|
| A01 | 摘要同类型合并计数 | 同类型通知折叠为"N 条 ×类型"，正文列前 5 条 + 站内链接 |
| A02 | 失败重试计数与死信 | `metadata.email_attempts` 计数，≥3 次记 `metadata.email_error` 并跳过，不再阻塞队列 |
| A03 | 高优先级类型实时单发 | security_alert / team_invite / payment_succeeded 事件触发即发（不经 cron 等待） |
| A04 | 用户时区 digest 错峰 | 按 `profiles.timezone` 分批，cron 每小时跑、只发到达本地 08:00 的用户 |
| A05 | 营销邮件独立通道 | marketingEmails 开关落地：订阅确认 + 双重确认 + 退订链接 |

### B. 对象存储（oss）

| # | 任务 | 说明 |
|---|------|------|
| B01 | OSS SDK 封装 + 上传 action | 签名直传或服务端中转收口，类型/大小白名单，单测覆盖 |
| B02 | 头像上传 | dashboard/profile 接入，Supabase Storage 兜底策略明确 |
| B03 | 项目封面/附件 | 项目详情页封面上传，复用 B01 收口 |

### C. 可观测性（observability）

| # | 任务 | 说明 |
|---|------|------|
| C01 | Appark APM 接入 | ADR-011 落地为生产代码（instrumentation + 采样配置） |
| C02 | cron worker 运行指标 | digest 成功/失败/耗时记录表或日志结构化，供看板查询 |
| C03 | 队列积压告警 | 待发通知超阈值（如 500 条）时 Sentry 告警 |

### D. 认证安全（auth）

| # | 任务 | 说明 |
|---|------|------|
| D01 | WebAuthn/Passkey 试点 | ADR 可行性结论 → 本地凭据注册/登录最小闭环（feature flag 门控） |
| D02 | 会话设备列表 UI | 会话管理页展示设备/UA/IP 元数据，单设备吊销 |
| D03 | 登录限流收口 | 邮箱滑窗锁定 + IP 维度策略统一进 rate-limit 模块 |

### E. 性能与重构（perf）

| # | 任务 | 说明 |
|---|------|------|
| E01 | Tailwind v4 `@theme` 试点 | v0.4.0 遗留项：选 1-2 页移除 `@config` 桥接，验证后全量排期 v0.6.0 |
| E02 | TanStack Query 缓存策略统一 | staleTime/gcTime/invalidate 约定收口到公共 queryOptions |
| E03 | 首屏加载优化 | 字体/图片 preload 复审，LCP 目标 ≤2.5s（Vercel Analytics 验证） |

### F. 测试补齐（test）

| # | 任务 | 说明 |
|---|------|------|
| F01 | E2E：邮件流程 | mock Resend 后走 contact→通知→digest 全链路 |
| F02 | E2E：admin/contact/MFA 页面补齐 | v0.4.0 新页面 Playwright 用例补齐 |
| F03 | 覆盖率 branches ≥85% | 现状 78% 门禁，重点补 actions/分支密集模块 |

### G. 文档与发布（docs/release）

| # | 任务 | 说明 |
|---|------|------|
| G01 | docs-site 新章节 | 邮件通道（digest/偏好/死信）与对象存储章节，中英双语 |
| G02 | ADR 增补 | ADR-010 OSS / ADR-011 APM 状态从 proposed → accepted |
| H01 | v0.5.0 发布基建 | 版本号、CHANGELOG、roadmap 转正、docs-site 版本页 |

## 里程碑

| 里程碑 | 内容 | 任务域 |
|--------|------|--------|
| M1 邮件通道收尾 | A01→A05 顺序推进，设计债清零 | A、F01 |
| M2 存储与可观测 | OSS 接入 + Appark/指标/告警 | B、C、G02 |
| M3 安全与性能 | Passkey 试点、限流收口、@theme 试点 | D、E |
| M4 收尾发布 | E2E/覆盖率/文档/发布基建 | F、G、H01 |

## 退出标准（全部满足方可发布 v0.5.0）

1. `pnpm verify:build` 全绿；覆盖率门禁不降低且 branches ≥85%。
2. `pnpm audit` 无高危；CodeQL/gitleaks 无告警。
3. email-templates.md 中无"未实现/后续增强"欠账（A 域全部落地或显式移出范围）。
4. OSS/Appark 在生产配置下可用（或 feature flag 关闭的完整实现）。
5. E2E 全绿（含邮件流程与 v0.4.0 新页面用例）。

## 风险

- A03 实时单发会改变"全部走 cron"的语义 → 保留偏好门控与回执复用，E2E 验证防重发。
- OSS 直传涉及签名与 CORS → 首版服务端中转，直传列为后续优化。
- WebAuthn 浏览器兼容差异 → feature flag 门控 + Mock 客户端先行。
