# 架构 Agent

> 负责 IndieStack 项目的架构设计、技术决策和演进规划。

## 技术栈架构

```
┌─────────────────────────────────────────────┐
│                 用户层                        │
│  Browser / Mobile / API Clients              │
├─────────────────────────────────────────────┤
│                Vercel Edge                   │
│  Next.js Middleware (Auth + i18n)            │
├─────────────────────────────────────────────┤
│              Next.js 16 App Router           │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Marketing │ │   Auth   │ │  Dashboard   │ │
│  │  Pages    │ │  Pages   │ │  + Admin     │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────────────────────────────────┐    │
│  │          Server Actions              │    │
│  │     Zod Validation → Supabase        │    │
│  └──────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│          外部服务层                           │
│  Supabase(Auth+DB)  Sentry  Stripe  阿里云OSS│
└─────────────────────────────────────────────┘
```

## 架构决策记录 (ADR)

> 项目 ADR 统一维护在 [`docs/adr/README.md`](../docs/adr/README.md)，本文件不再内嵌另一套编号。
> 新增或修改架构决策时，必须先更新 ADR 正文与索引，并运行 `pnpm check:adr`。

## 数据流设计

### 认证流程
```
请求 → proxy.ts (Cookie 检查) → 受保护路由？
  ├─ 否 → 继续
  └─ 是 → 有 session？
       ├─ 否 → 重定向到 /auth/login
       └─ 是 → Server Component 通过 createClient() 获取用户数据
```

### 数据查询模式
```
Server Component → createClient() → Supabase query → fallback UI
Client Component → useUser() hook → Supabase subscription → 实时更新
API Route → createClient() / admin client → 带权限查询 → 响应
```
