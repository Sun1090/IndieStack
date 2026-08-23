---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "IndieStack"
  text: "独立开发者的 SaaS 启动模板"
  tagline: Next.js 15 · Tailwind CSS · shadcn/ui · Supabase · PostgreSQL · Sentry · 阿里云 · Vercel
  image:
    src: /favicon.svg
    alt: IndieStack
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-CN/quickstart
    - theme: alt
      text: 技术栈详解
      link: /zh-CN/tech-stack
    - theme: alt
      text: GitHub
      link: https://github.com/Sun1090/IndieStack

features:
  - title: "🏗️ 现代架构"
    details: Next.js 15 App Router + Server Components + Server Actions + Route Groups，构建类型安全的全栈应用。
  - title: "🎨 组件驱动"
    details: 基于 shadcn/ui 的 23 个可定制组件，Tailwind CSS 深色/浅色双主题，响应式设计。
  - title: "🔐 开箱即用认证"
    details: Supabase Auth 集成（邮箱 + GitHub + Google），SSR 会话管理，中间件路由保护。
  - title: "📊 数据层完备"
    details: PostgreSQL + Row Level Security + 实时订阅，4 种 Supabase 客户端（server/client/admin/middleware）。
  - title: "💳 支付就绪"
    details: Stripe 订阅计费，Webhook 处理，Checkout 结账，Customer Portal 自助管理。
  - title: "🛡️ 生产级监控"
    details: Sentry 错误追踪（client/edge/server），结构化日志，安全响应头。
  - title: "🚀 一键部署"
    details: Vercel + GitHub Actions CI/CD，Docker 容器化，环境变量分环境管理。
  - title: "🌐 国际化"
    details: 内置中文/英文双语言，50+ 翻译命名空间，Cookie 驱动，服务端/客户端统一。
---
