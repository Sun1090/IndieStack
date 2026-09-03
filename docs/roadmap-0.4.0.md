# IndieStack v0.4.0 Roadmap

> 主题：**Admin 运营闭环 + 数据层测试 + 集成接线**
> 基线：v0.3.0（Next.js 16 / Tailwind 4 / 402 单测全绿）→ 目标：v0.4.0
> 任务池：150 项（A–R 共 18 域），本文件只定范围、里程碑与退出标准，明细见任务跟踪。

## 范围（in scope）

- **测试补齐**：repository 层 7 模块、API 路由 6 条、组件 10+、E2E 新页面与核心流程。
- **安全/数据**：RLS 回归覆盖新表、service_role 审计、010/012 迁移确认、索引复审。
- **运营闭环**：联系消息状态机/搜索分页、通知类型扩展、admin 聚合看板、MFA 恢复码。
- **集成与质量**：API 错误格式收敛、Table v9 原生迁移、Tailwind `@theme` 试点、bundle 基线更新。

## 非范围（out of scope）

- 阿里云 OSS 正式接线、Appark 接入（二者只做 ADR 决策 collab，不写生产代码）。
- WebAuthn/Passkey（仅可行性 ADR）。
- 多语言新增语种（只做术语表与贡献指南）。

## 里程碑

| 里程碑 | 内容 | 任务域 |
|--------|------|--------|
| M1 发布基建 + 数据层测试 | 版本号、CHANGELOG、roadmap、repo 单测全覆盖 | A、B |
| M2 接口与安全 | API 单测/收敛/审计、RLS/依赖/密钥扫描、迁移确认 | C、F、G |
| M3 功能闭环 | 通知/联系/MFA/Admin 后台/I18N | H、I、J、K、L、M |
| M4 性能可观测与发布 | 性能、Sentry/Appark 决策、CI/CD、文档、重构、E2E/组件收尾 | D、E、N、O、P、Q、R |

## 退出标准（全部满足方可发布 v0.4.0）

1. `pnpm verify:build` 全绿（lint / type-check / test / build，含 i18n 缺键门禁）。
2. 覆盖率门禁不降低（statements/functions/lines ≥ 90%、branches ≥ 78%）。
3. RLS 回归脚本覆盖全部生产表且通过；`pnpm audit` 无高危。
4. CHANGELOG `[Unreleased]` 转正为 `[0.4.0]` 并写发布日期；docs-site 功能章节同步。
5. E2E 在 CI 全绿（含新增 admin/contact/MFA 用例）。

## 风险

- Supabase 本地/远端迁移漂移（010/012）→ M2 的 G01/G05 先行确认。
- Table v9 原生迁移与 Tailwind `@theme` 重写有回归风险 → R01/R02 只做试点页，门禁是 E2E 全绿。
