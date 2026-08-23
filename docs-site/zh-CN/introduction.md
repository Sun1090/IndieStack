# 简介

**IndieStack** 是面向独立开发者的生产级 SaaS 启动模板。开箱即用包含认证、多租户团队、订阅计费、错误监控、CI/CD 与双语文档——让你专注于产品创意，而不是重复造轮子。

## 内置能力

| 能力 | 实现方式 |
|---|---|
| 🔐 用户认证 | Supabase Auth（邮箱 / GitHub / Google OAuth），SSR 会话管理，中间件路由保护 |
| 👥 多租户团队 | Owner / Admin / Member 三级角色，成员邀请，Postgres RLS 强制数据隔离 |
| 💳 订阅计费 | Stripe Checkout，Webhook 驱动的订阅状态同步，Customer Portal 自助管理 |
| 📊 数据分析 | 请求指标、错误率、时间线图表（Recharts） |
| 🛡️ 生产监控 | Sentry 三端接入（client/server/edge），结构化日志，CSP nonce 安全头 |
| 🌐 国际化 | 中英双语言（next-intl），Cookie 驱动切换，733 个翻译键双语对称 |

## 技术栈

- **框架**: [Next.js 15](https://nextjs.org) App Router —— 默认 Server Components，变更走 Server Actions
- **数据库**: [Supabase](https://supabase.com)（PostgreSQL），所有表启用 Row Level Security
- **UI**: [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)，深色/浅色主题
- **校验**: [Zod v4](https://zod.dev) schema 在客户端表单与服务端 Action 间共享
- **测试**: Vitest（270+ 单元/组件测试，核心逻辑覆盖率门禁 ≥90%）+ Playwright E2E 冒烟测试
- **CI/CD**: GitHub Actions（lint / 类型检查 / i18n 对称性 / 测试 / 构建 / CodeQL / gitleaks）+ Vercel 部署

## 设计原则

1. **默认安全** —— 每张数据表都有 RLS 策略；认证守卫在 middleware、页面、Action 三层生效。
2. **服务端优先** —— 写操作统一走 Server Actions；API 路由仅保留给外部回调（Stripe Webhook、OAuth）。
3. **端到端类型安全** —— 生成的数据库类型贯穿 client、action 与 UI。
4. **测试核心逻辑** —— CI 强制覆盖率门禁；每次发布自动跑完整验证矩阵。

## 下一步

- 跟随 [快速开始](/zh-CN/quickstart) 在本地跑通项目
- 在 [认证流程](/zh-CN/auth-flow) 理解请求生命周期
- 参考 [部署方案](/zh-CN/deployment) 部署你自己的实例
