# IndieStack

[English](README.md) | **中文**

[![CI](https://github.com/Sun1090/IndieStack/actions/workflows/ci.yml/badge.svg)](https://github.com/Sun1090/IndieStack/actions/workflows/ci.yml)

> 面向独立开发者的生产级 SaaS 启动模板。

基于 **Next.js 16**、**Tailwind CSS**、**shadcn/ui**、**Supabase**、**PostgreSQL**、**Sentry**、**Vercel**、**GitHub Actions**、**阿里云 OSS** 与 **Appark** 构建。

## 功能特性

### 🏗️ 架构
- Next.js 16 App Router + Route Groups
- React Server Components + Server Actions
- Supabase SSR 认证（邮箱、GitHub、Google）
- PostgreSQL + 行级安全（RLS）
- 多租户团队管理
- Stripe-ready 订阅计费

### 🎨 UI/UX
- shadcn/ui 组件库（完全可定制）
- 暗色/亮色模式（跟随系统）
- 响应式设计（移动优先）
- Toast 通知
- 加载骨架与错误边界

### 📊 仪表盘
- 概览页（统计与活动流）
- 用量分析
- 个人资料编辑
- 团队管理（角色与邀请）
- 订阅计费
- 通知偏好

### 🛡️ 生产就绪
- Sentry 错误监控（客户端 + 服务端 + edge）
- 安全响应头（XSS、CSRF、点击劫持）
- 限流基础设施
- GitHub Actions CI/CD
- 阿里云 OSS 文件存储

## 快速开始

```bash
# 克隆
git clone <repo-url> indiestack
cd indiestack

# 安装
pnpm install

# 配置
cp .env.example .env.local
# 编辑 .env.local 填入 Supabase 凭据

# 运行
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

> 线上演示：https://indie-stack-theta.vercel.app · 文档：https://indie-stack-docs-site.vercel.app

## 文档

项目包含两套文档体系：

### 1. 内联文档 `/docs/`
`/docs` 目录包含 7 个 Markdown 文件，覆盖架构、设置、技术栈、Supabase、部署、配置等。

| 文件 | 说明 |
|------|------|
| `architecture.md` | 项目架构、数据流、路由设计 |
| `setup.md` | 本地开发设置、环境变量 |
| `tech-stack.md` | 每项技术的深度介绍 |
| `supabase.md` | 数据库 Schema、认证、RLS 策略 |
| `deployment.md` | Vercel、阿里云、Sentry、GitHub Actions 部署指南 |
| `configuration.md` | 所有环境变量和配置说明 |

### 2. 独立文档站 `docs-site/`（VitePress）
基于 VitePress 的独立文档站，支持中英双语、暗色/亮色主题，可脱离主应用单独部署。

```bash
cd docs-site
pnpm install
pnpm dev        # 本地开发服务器（默认 http://localhost:5173）
pnpm build      # 构建静态站点（输出到 .vitepress/dist/）
pnpm preview    # 本地预览
```

**部署**：Vercel — 在 Vercel 中导入 `docs-site/` 目录，或 `cd docs-site && vercel --prod`。Docker — `cd docs-site && docker build -t indiestack-docs . && docker run -d -p 8080:80 indiestack-docs`。

## 项目结构

```
src/
├── app/                  # Next.js App Router
│   ├── (marketing)/      # 公开页面
│   ├── auth/             # 认证页面
│   ├── dashboard/        # 仪表盘页面
│   └── api/              # API 路由
├── components/
│   ├── ui/               # shadcn/ui 组件
│   ├── auth/             # 认证表单
│   ├── layout/           # 页头、页脚、主题
│   ├── dashboard/        # 仪表盘组件
│   ├── forms/            # 表单组件
│   └── shared/           # 共享组件
├── hooks/                # 自定义 hooks
├── lib/
│   ├── supabase/         # Supabase 客户端
│   ├── validations/      # Zod schemas
│   ├── actions/          # Server Actions
│   ├── constants.ts      # 应用常量
│   └── utils.ts          # 工具函数
└── middleware.ts          # 认证中间件
```

## 脚本

| 命令 | 说明 |
|---------|-------------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm lint` | 运行 ESLint |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm format` | Prettier 格式化 |
| `pnpm check` | type-check + lint + i18n 对称性校验 |
| `pnpm check:locales` | 校验 en/zh-CN 翻译 key 对称性 |
| `pnpm db:migrate` | 推送数据库迁移 |
| `pnpm db:types` | 从 DB 生成 TypeScript 类型 |
| `pnpm test` | Vitest 单元 + 组件测试（253+ 用例） |
| `pnpm test:e2e` | Playwright E2E 冒烟测试 |

## 测试

- **单元/组件**：Vitest 双项目（node + jsdom），核心逻辑覆盖率门禁 ≥90%。
- **E2E**：Playwright 冒烟测试（`pnpm test:e2e`，本地 Mock 模式无需 Supabase）。
- **CI**：GitHub Actions 五道关卡 —— Lint & Type Check / Build / E2E / Build Docs / CodeQL + gitleaks 安全扫描。

## Agent 体系

项目内置 10 个专业化协作 Agent（见 [AGENTS.md](./AGENTS.md)）：代码编写、代码审查、项目审查、架构师、测试工程师、文档编写、数据库管理、DevOps、UI/UX 设计、提交与发布。

## 技术栈

| 类别 | 技术 |
|----------|-----------|
| 框架 | Next.js 16（App Router, RSC） |
| 样式 | Tailwind CSS + shadcn/ui |
| 认证 | Supabase Auth（邮箱、GitHub、Google） |
| 数据库 | PostgreSQL（via Supabase） |
| 存储 | 阿里云 OSS |
| 监控 | Sentry |
| CI/CD | GitHub Actions |
| 托管 | Vercel |
| APM | Appark |
| 支付 | Stripe（ready） |
| 校验 | Zod |

## 独立文档站（`docs-site/`）

基于 VitePress 的独立文档站（`docs-site/`），双语、暗色/亮色主题，可单独部署。

```bash
cd docs-site
pnpm install
pnpm dev        # 本地开发服务器（默认 http://localhost:5173）
pnpm build      # 构建到 .vitepress/dist/
pnpm preview    # 本地预览
```

## 赞助

如果这个项目对你有帮助，可以请作者喝杯咖啡，支持持续更新 ☕

<table>
  <tr>
    <td align="center"><img src="public/donate-alipay.jpg" width="200" alt="支付宝赞赏码" /><br/>支付宝</td>
    <td align="center"><img src="public/donate-wechat.jpg" width="200" alt="微信赞赏码" /><br/>微信</td>
  </tr>
</table>

## 许可

MIT
