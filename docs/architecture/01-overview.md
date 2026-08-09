# 总体架构概览

> IndieStack — 面向独立开发者的生产级 SaaS 启动模板

## 架构定位

IndieStack 是一个全栈 SaaS 应用模板，采用 **Next.js App Router** 全栈架构，前后端一体化部署。核心理念是让独立开发者能够快速启动一个包含认证、支付、团队管理、国际化、监控等完整功能的生产级应用。

## 系统架构图

```mermaid
graph TB
    subgraph Client["客户端层"]
        Browser["浏览器"]
        Mobile["移动端浏览器"]
    end

    subgraph NextApp["Next.js 应用（全栈）"]
        subgraph Frontend["前端层"]
            Pages["App Router 页面<br/>(Marketing / Auth / Dashboard / Admin)"]
            Components["React 组件<br/>(UI / Layout / Shared / Charts)"]
            Hooks["自定义 Hooks"]
        end

        subgraph Middleware["中间件层"]
            MW["Edge Middleware<br/>会话刷新 + 路由保护"]
        end

        subgraph Server["服务端层"]
            ServerComponents["Server Components"]
            ServerActions["Server Actions"]
            APIRoutes["API Route Handlers"]
            Guards["Auth Guards<br/>(RBAC 权限校验)"]
            Validations["Zod 输入验证"]
        end

        subgraph Lib["核心库层"]
            SupabaseLib["Supabase 客户端<br/>(Server / Browser / Admin)"]
            StripeLib["Stripe 集成"]
            StorageLib["OSS 存储模块"]
            LoggerLib["结构化日志"]
            RateLimitLib["速率限制"]
            MockLib["Mock 系统"]
        end
    end

    subgraph External["外部服务"]
        Supabase["Supabase<br/>(PostgreSQL + Auth + Storage)"]
        Stripe["Stripe<br/>(支付/订阅)"]
        Sentry["Sentry<br/>(错误监控)"]
        OSS["阿里云 OSS<br/>(文件存储)"]
        Appark["Appark<br/>(APM 性能监控)"]
    end

    Browser --> MW
    Mobile --> MW
    MW --> Pages
    Pages --> Components
    Components --> Hooks
    MW --> SupabaseLib
    Pages --> ServerComponents
    ServerComponents --> Guards
    ServerComponents --> ServerActions
    ServerComponents --> APIRoutes
    ServerActions --> Validations
    APIRoutes --> Validations
    Guards --> SupabaseLib
    ServerActions --> SupabaseLib
    APIRoutes --> SupabaseLib
    SupabaseLib --> Supabase
    StripeLib --> Stripe
    StorageLib --> OSS
    LoggerLib --> Sentry
    Lib --> Appark
```

## 架构分层

```mermaid
graph LR
    subgraph L1["表现层"]
        P["Pages / Components / Hooks"]
    end
    subgraph L2["中间件层"]
        M["Middleware<br/>会话 + 路由守卫"]
    end
    subgraph L3["业务逻辑层"]
        SA["Server Actions"]
        API["API Routes"]
        G["Auth Guards"]
    end
    subgraph L4["数据访问层"]
        S["Supabase Client"]
        ST["Stripe Client"]
        OS["OSS Client"]
    end
    subgraph L5["基础设施层"]
        DB["PostgreSQL"]
        EXT["外部服务"]
    end

    L1 --> L2 --> L3 --> L4 --> L5
```

项目分为五个清晰的层次：

1. **表现层** — App Router 页面、React 组件、自定义 Hooks，负责 UI 渲染和用户交互
2. **中间件层** — Edge Middleware，处理会话刷新和路由级保护，在每个请求到达页面前执行
3. **业务逻辑层** — Server Actions、API Route Handlers、Auth Guards，处理业务逻辑和权限校验
4. **数据访问层** — Supabase 客户端（Server/Browser/Admin）、Stripe 客户端、OSS 客户端，封装外部服务访问
5. **基础设施层** — PostgreSQL 数据库、Stripe 支付网关、Sentry 错误监控、阿里云 OSS、Appark APM

## 核心设计原则

- **全栈一体化** — 前后端代码在同一仓库，通过 Server Components 和 Server Actions 消除 API 边界
- **类型安全** — TypeScript 严格模式贯穿全栈，Supabase 数据库类型自动生成
- **Cookie 会话** — 使用 `@supabase/ssr` 基于 Cookie 的会话管理，适配 Server Components
- **RBAC 权限** — 四级角色体系（super_admin / admin / member / viewer），细粒度权限控制
- **Mock 开发模式** — 无需真实后端即可本地开发，通过环境变量切换
- **国际化** — `next-intl` Cookie 策略，URL 无语言前缀，支持中英文
- **安全优先** — 速率限制、输入验证（Zod）、安全 Headers、RLS 策略

## 技术栈速览

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | ^15.2.0 |
| 语言 | TypeScript | ^5.7.3 |
| UI | React + Tailwind CSS + shadcn/ui | React ^19.0.0 |
| 数据库 | PostgreSQL (via Supabase) | Supabase ^2.49.1 |
| 认证 | Supabase Auth (Cookie SSR) | @supabase/ssr ^0.6.1 |
| 支付 | Stripe | ^22.3.2 |
| 国际化 | next-intl | ^4.13.2 |
| 错误监控 | Sentry | @sentry/nextjs ^9.5.0 |
| 文件存储 | 阿里云 OSS | 自定义封装 |
| 性能监控 | Appark APM | 自定义封装 |
| 测试 | Vitest + @faker-js/faker | Vitest ^4.1.10 |
| 包管理 | pnpm | — |
| 部署 | Docker / Vercel | — |

## 页面路由分组

```mermaid
graph TD
    Root["/"]
    subgraph Marketing["(marketing) 路由组"]
        M_Home["/ (Home)"]
        M_Features["/features"]
        M_Pricing["/pricing"]
        M_About["/about"]
        M_Blog["/blog"]
        M_FAQ["/faq"]
        M_Changelog["/changelog"]
        M_Contact["/contact"]
        M_Privacy["/privacy"]
        M_Terms["/terms"]
    end
    subgraph Auth["/auth 认证页"]
        A_Login["/auth/login"]
        A_Register["/auth/register"]
        A_Forgot["/auth/forgot-password"]
        A_Reset["/auth/reset-password"]
        A_Callback["/auth/callback"]
    end
    subgraph Dashboard["/dashboard 仪表盘"]
        D_Overview["/dashboard"]
        D_Analytics["/dashboard/analytics"]
        D_Profile["/dashboard/profile"]
        D_Settings["/dashboard/settings"]
        D_Team["/dashboard/team"]
        D_Projects["/dashboard/projects"]
        D_Billing["/dashboard/billing"]
        D_Notifications["/dashboard/notifications"]
        D_Integrations["/dashboard/integrations"]
        D_APIKeys["/dashboard/api-keys"]
        subgraph Admin["/dashboard/admin"]
            AD_Users["/dashboard/admin/users"]
            AD_Audit["/dashboard/admin/audit-logs"]
        end
    end
    subgraph API["/api API 路由"]
        API_Health["/api/health"]
        API_User["/api/user"]
        API_Teams["/api/teams"]
        API_Invitations["/api/invitations"]
        API_Analytics["/api/analytics"]
        API_Stripe["/api/webhooks/stripe"]
        API_Auth["/api/auth/callback"]
    end

    Root --> Marketing
    Root --> Auth
    Root --> Dashboard
    Root --> API
```

## 关键数据流

```mermaid
sequenceDiagram
    participant U as 用户浏览器
    participant MW as Edge Middleware
    participant SC as Server Component
    participant SB as Supabase Server Client
    participant DB as PostgreSQL
    participant R as React Client Component

    U->>MW: HTTP 请求
    MW->>SB: 刷新会话 (Cookie)
    SB->>DB: auth.getUser()
    DB-->>SB: 用户信息
    SB-->>MW: 更新 Cookie + user
    MW->>MW: 路由保护检查
    alt 未登录访问保护路由
        MW-->>U: 302 重定向到 /auth/login
    else 已登录
        MW->>SC: 渲染 Server Component
        SC->>SB: 查询数据
        SB->>DB: SQL 查询 (RLS)
        DB-->>SB: 数据
        SB-->>SC: 数据
        SC-->>U: HTML (含 RSC Payload)
        U->>R: 水合 React
    end
```

## 文档导航

| 文档 | 内容 |
|------|------|
| [02-tech-stack.md](./02-tech-stack.md) | 技术栈详解 |
| [03-project-structure.md](./03-project-structure.md) | 目录结构说明 |
| [04-routing.md](./04-routing.md) | 路由体系 |
| [05-auth-rbac.md](./05-auth-rbac.md) | 认证与 RBAC 权限系统 |
| [06-database.md](./06-database.md) | 数据库设计 |
| [07-api-routes.md](./07-api-routes.md) | API 路由设计 |
| [08-server-actions.md](./08-server-actions.md) | Server Actions |
| [09-frontend-components.md](./09-frontend-components.md) | 前端组件体系 |
| [10-i18n.md](./10-i18n.md) | 国际化方案 |
| [11-integrations.md](./11-integrations.md) | 第三方集成 |
| [12-deployment.md](./12-deployment.md) | 部署架构 |
| [13-mock-system.md](./13-mock-system.md) | Mock 开发模式 |
| [14-data-flow.md](./14-data-flow.md) | 核心业务数据流程 |
