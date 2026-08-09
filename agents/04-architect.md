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
│              Next.js 15 App Router           │
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

### ADR-001: 使用 Server Components 优先
- **决定**: 默认使用 Server Components，仅在需要浏览器 API 或交互状态时使用 Client Components
- **理由**: 减少客户端 JS 体积、更好的 SEO、更快的首屏加载
- **例外**: 表单交互、实时更新、浏览器 API 访问

### ADR-002: RBAC 权限在前端+后端双层校验
- **决定**: 中间件做基本路由保护，布局层做角色检查，API 路由做安全守卫
- **理由**: 深度防御，防止越权访问
- **实现**: `middleware.ts` → `admin/layout.tsx` → `guards.ts`

### ADR-003: i18n 使用 Cookie 而非路径前缀
- **决定**: 语言偏好存储在 Cookie 中，而非 URL 路径
- **理由**: 简化路由结构，避免 URL 重写，SEO 通过 alternate hreflang 处理
- **例外**: 文档站使用路径前缀（Vitepress 原生支持）

### ADR-004: Mock 模式用于本地开发
- **决定**: `NEXT_PUBLIC_MOCK_ENABLED=true` 时使用内存 Mock 客户端
- **理由**: 无需 Supabase 账号即可开发所有页面
- **实现**: `src/lib/mock/index.ts` + `src/lib/mock/data.ts`

## 数据流设计

### 认证流程
```
请求 → middleware (Cookie 检查) → 受保护路由？
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
