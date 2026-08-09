 # Supabase 集成
 
 IndieStack 深度集成 Supabase，提供认证、数据库、实时订阅等后端服务。
 
 ## 客户端类型
 
 | 客户端 | 文件 | 使用场景 | 特性 |
 |--------|------|----------|------|
 | Server Client | `src/lib/supabase/server.ts` | Server Components, Route Handlers, Server Actions | 通过 Cookie 管理会话，自动处理 Token 刷新 |
 | Browser Client | `src/lib/supabase/client.ts` | Client Components | 浏览器端直接查询，自动处理会话 Cookie |
 | Admin Client | `src/lib/supabase/admin.ts` | 服务端特权操作 | 使用 Service Role Key，绕过 RLS |
 | Middleware | `src/lib/supabase/middleware.ts` | Next.js Middleware | 请求级会话刷新，与路由保护集成 |
 
 ## 数据表
 
 ### profiles（用户资料）
 
 通过数据库触发器自动创建：当用户在 Supabase Auth 注册时，`handle_new_user()` 触发器自动在 `profiles` 表中创建对应记录。
 
 ```sql
 -- 核心字段
 id         UUID PRIMARY KEY → auth.users(id)
 email      TEXT
 full_name  TEXT
 avatar_url TEXT
 role       TEXT → 'user' | 'admin'
 ```
 
 ### teams（团队/组织 - 多租户）
 
 支持多租户架构，每个用户可以属于多个团队：
 
 - **owner**: 团队创建者，拥有全部权限
 - **admin**: 团队管理员，可管理成员和设置
 - **member**: 普通成员，可读写项目
 - **viewer**: 只读成员，仅可查看
 
 ### team_members（团队成员关联）
 
 存储用户与团队的关联关系及角色：
 
 ```sql
 id         UUID PRIMARY KEY
 team_id    UUID → teams(id)
 user_id    UUID → auth.users(id)
 role       TEXT → 'owner' | 'admin' | 'member' | 'viewer'
 invited_by UUID → auth.users(id)
 ```
 
 ### projects（项目）
 
 与团队关联的项目表，支持状态管理：
 
 ```sql
 id          UUID PRIMARY KEY
 team_id     UUID → teams(id)
 name        TEXT
 description TEXT
 status      TEXT → 'active' | 'draft' | 'maintenance'
 domain      TEXT
 branch      TEXT
 ```
 
 ### subscriptions（订阅信息）
 
 存储 Stripe 订阅状态：
 
 ```sql
 id           UUID PRIMARY KEY
 team_id      UUID → teams(id)
 provider     TEXT → 'stripe'
 status       TEXT → 'active' | 'canceled' | 'past_due'
 plan         TEXT → 'free' | 'pro' | 'enterprise'
 period_start TIMESTAMPTZ
 period_end   TIMESTAMPTZ
 ```
 
 ## 迁移文件
 
 | 文件 | 内容 |
 |------|------|
 | `supabase/migrations/001_initial_schema.sql` | 基础表结构、触发器、RLS 策略 |
 | `supabase/migrations/002_rbac_audit.sql` | RBAC 表、审计日志、权限函数 |
 | `supabase/migrations/003_projects_notifications_indexes.sql` | 通知系统、索引优化 |
 
 ## RLS 策略
 
 所有表使用 Row Level Security：
 
 - **profiles**: 用户只能读写自己的数据（`id = auth.uid()`）
 - **teams**: 成员可读，owner/admin 可写
 - **team_members**: 用户只能看到自己所在的团队
 - **projects**: 团队成员可读写所属团队项目
 - **subscriptions**: 仅 team owner/admin 可查看
 
 ## Mock 模式（开发）
 
 当 `NEXT_PUBLIC_MOCK_ENABLED=true` 时，无需真实 Supabase 后端：
 
 - `src/lib/mock/index.ts`: Mock 查询构建器，模拟 PostgREST 查询链
 - `src/lib/mock/data.ts`: 使用 `@faker-js/faker` 生成真实开发数据
 - 支持 `eq()`, `order()`, `range()`, `limit()`, `single()` 等查询方法
 - 模拟数据包括用户、团队、项目、通知、审计日志等
 
 ```typescript
 // Mock 模式自动检测
 export function shouldUseMock(): boolean {
   return process.env.NEXT_PUBLIC_MOCK_ENABLED === "true"
       || !process.env.NEXT_PUBLIC_SUPABASE_URL;
 }
 ```
 
 ## 生成数据库类型
 
 ```bash
 pnpm db:types
 # 执行: supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 ```
 
 生成的类型定义覆盖所有表结构，提供编译期类型安全。
