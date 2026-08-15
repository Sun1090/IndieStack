# 项目架构

## 多层架构

```
┌─────────────────────────────────────────────┐
│              Presentation Layer              │
│  Server Components  Client Components        │
│  Route Groups  Layouts  Templates            │
├─────────────────────────────────────────────┤
│              Application Layer              │
│  Server Actions  API Routes  Middleware      │
│  Auth Guard  i18n  Rate Limiting             │
├─────────────────────────────────────────────┤
│                 Data Layer                  │
│  Supabase Clients  Zod Validations          │
│  Server Actions  RLS Policies               │
├─────────────────────────────────────────────┤
│              Infrastructure                 │
│  Supabase  PostgreSQL  Vercel  Sentry       │
│  Alibaba OSS  Stripe  Docker  GitHub CI    │
└─────────────────────────────────────────────┘
```

## 数据流

```
用户请求 → Middleware (语言检测 + 认证保护)
         → Route Group 匹配
         → Layout (Theme + Provider)
         → Page Server Component
              ↓
         Supabase 数据查询
         → Server Component Renders
         ↓
         客户端交互 → Server Actions
                   → 客户端 Supabase 数据变更
                   → UI 实时更新
```

## 路由设计

| 组 | 路由 | 说明 |
|----|------|------|
| Marketing | `/`, `/features`, `/pricing`, `/blog` | 公开页面 |
| Auth | `/auth/login`, `/auth/register` | 认证页面 |
| Dashboard | `/dashboard`, `/dashboard/team` | 受保护页面 |
| Docs | `https://indiestack-docs.vercel.app` | 独立 VitePress 文档站（可单独部署） |
