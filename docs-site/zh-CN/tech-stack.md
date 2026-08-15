 # 技术栈详解
 
 IndieStack 集成了 2026 年前端技术栈的主流选择，涵盖框架、样式、后端、监控、部署等全链路。
 
 ## 框架与语言
 
 | 技术 | 版本 | 用途 | 关键特性 |
 |------|------|------|----------|
 | Next.js | 15.5.x | React 全栈框架 | App Router、Server Components、Server Actions、Streaming SSR |
 | TypeScript | 5.7.x | 类型安全 | Strict 模式、编译时类型检查、类型生成 |
 | React | 19.x | UI 库 | Server Components、Taint APIs、use hook、Actions |
 
 Next.js 15 的 App Router 提供了基于文件系统的路由、布局嵌套、加载态和错误边界。
 Server Components 默认减少客户端 JS 体积，Server Actions 实现表单和数据库操作的端到端类型安全。
 
 ## 样式与 UI
 
 | 技术 | 版本 | 用途 | 关键特性 |
 |------|------|------|----------|
 | Tailwind CSS | 3.4.x | 工具类 CSS | JIT 编译、dark mode class 策略、响应式断点 |
 | shadcn/ui | Latest | 组件库 | 基于 Radix UI、24 个可定制组件、Copy-paste 模式 |
 | Lucide React | 0.477.x | 图标库 | 1000+ 开源图标、Tree-shaking 优化 |
 
 shadcn/ui 并非传统 npm 包——组件源码直接复制到 `src/components/ui/` 目录中，完全可控。
 项目使用 `cn()` 工具函数（clsx + tailwind-merge）处理类名合并和冲突解决。
 CSS 变量定义在 `globals.css` 中，通过 `.dark` class 实现主题切换。
 
 ## 后端与数据库
 
 | 技术 | 版本 | 用途 | 关键特性 |
 |------|------|------|----------|
 | Supabase | 2.x | BaaS | 托管 PostgreSQL、Auth（内置 RLS 集成）、Realtime 订阅 |
 | PostgreSQL | 15+ | 关系数据库 | RLS 行级安全、JSON/JSONB、全文搜索、索引优化 |
 | Zod | 3.24.x | Schema 验证 | 前后端共享类型、反序列化验证、类型推断 |
 
 ### Supabase 客户端架构
 
 四种客户端分别应对不同场景：
 
 | 客户端 | 场景 | 特性 |
 |--------|------|------|
 | `server.ts` | Server Components、Route Handlers | Cookie 会话管理 |
 | `client.ts` | Client Components | 浏览器端查询 |
 | `admin.ts` | 服务端特权操作 | Service Role，绕过 RLS |
 | `middleware.ts` | Next.js Middleware | 请求级会话刷新 |
 
 ### Mock 模式（独立开发关键特性）
 
 当 `NEXT_PUBLIC_MOCK_ENABLED=true` 时，所有 Supabase 查询使用 `@faker-js/faker` 生成模拟数据：
 
 - 自动检测 Supabase 环境变量是否配置，未配置时自动启用 Mock
 - 模拟完整的用户、团队、项目、通知、审计日志数据
 - 一次请求内数据缓存一致（同一路请求返回相同模拟用户）
 - 支持 eq/order/range/limit/single 等查询方法
 
 ## 监控与运维
 
 | 技术 | 用途 | 配置方式 |
 |------|------|----------|
 | Sentry | 错误追踪 + 性能监控 | Client/Edge/Server 三端配置，Source Maps 自动上传 |
 | Appark | 应用性能监控（APM，规划中） | 未接线，模块已移除 |
 | Stripe | 支付处理 | 订阅计费、Webhook 处理、价格方案管理 |
 
 Sentry 通过 `instrumentation.ts` 自动加载，分别在 `sentry/client.config.ts`、`sentry/server.config.ts`、`sentry/edge.config.ts` 中配置。
 Appark 当前为**规划中/未接线**，历史模块已移除，未接入任何页面。
 
 ## 部署方案
 
 | 平台 | 用途 | 部署方式 |
 |------|------|----------|
 | Vercel | 前端 + API 托管 | GitHub 自动部署（`vercel --prod`） |
 | GitHub Actions | CI/CD | PR 自动 lint + type-check + test，合并 main 自动部署 |
 | Docker | 容器化部署 | 多阶段构建（Node → Nginx），Docker Compose 本地开发 |
 | 阿里云 OSS | 文件存储 + CDN（规划中） | 未接线，详见架构文档 |
 
 ## 版本管理
 
 - **代码质量**: ESLint（Next.js 规则集）+ Prettier + husky（pre-commit + commit-msg hooks）
 - **提交规范**: Conventional Commits（`feat`/`fix`/`docs`/`chore`/`refactor`/`test`）
 - **分支策略**: `main`（生产）→ `develop`（开发）→ `feature/*`（功能分支）
 - **CI 流水线**: PR → lint + type-check + test → merge → auto deploy
