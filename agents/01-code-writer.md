# 代码编写 Agent

> 负责在 IndieStack 项目中编写高质量、符合项目规范的代码。

## 核心原则

### 1. 遵循项目现有模式
- 所有仪表盘页面使用 `export const dynamic = "force-dynamic"`
- Server Actions 在 `src/lib/actions/` 中，配合 Zod 校验
- Supabase 客户端：`server.ts`（Server Components）、`client.ts`（浏览器）、`admin.ts`（Service Role）
- 路由常量在 `src/lib/constants.ts` —— 始终使用 `ROUTES.*` 进行导航
- 默认使用 Server Components，仅在需要交互时使用 Client Components
- shadcn/ui 组件在 `src/components/ui/` —— 通用无应用逻辑

### 2. 国际化优先
- 所有用户可见文本必须使用 i18n
- 服务端：`const t = await getTranslations("namespace")`
- 客户端：`const t = useTranslations("namespace")`
- 在 `zh-CN.ts` 和 `en.ts` 中同时添加翻译键，确保对称

### 3. 组件组织
| 目录 | 内容 |
|------|------|
| `src/components/ui/` | shadcn/ui 原语 |
| `src/components/auth/` | 认证相关组件 |
| `src/components/layout/` | 布局组件（Header, Footer, ThemeToggle, LocaleSwitcher）|
| `src/components/dashboard/` | 仪表盘专用组件 |
| `src/components/forms/` | 表单组件 |
| `src/components/shared/` | 共享通用组件（Breadcrumbs, ConfirmDialog, EmptyState 等）|
| `src/components/charts/` | 图表组件 |
| `src/components/providers/` | Provider 组件 |
| `src/components/data-tables/` | 数据表格组件 |

### 4. 新功能开发模式
1. 添加 DB 迁移 → `supabase/migrations/`
2. 添加校验 schema → `src/lib/validations/`
3. 添加 Server Actions → `src/lib/actions/`
4. 添加页面 → `src/app/{route}/page.tsx`
5. 添加路由常量 → `src/lib/constants.ts`
6. 添加导航链接 → sidebar 或 header
7. 添加组件 → `src/components/`
8. 添加国际化文本 → `src/lib/i18n/messages/`
9. 更新文档 → `agents/` 和 `docs-site/`

### 5. TypeScript 风格
- 使用 `interface` 而非 `type` 定义 Props
- Server Component Props: `{ children: React.ReactNode }`
- 避免 `any`，优先使用 `unknown` 配合类型守卫
- 数据库查询使用类型断言处理 RLS 类型问题

### 6. 错误处理
- Server Components: try/catch 包裹 Supabase 查询，提供回退 UI
- Client Components: 错误边界，Server Action 错误通过 toast 提示
- API Routes: try/catch 配合正确的 HTTP 状态码
- Sentry: 在 catch 块中调用 `Sentry.captureException()`
- 表单: Zod 校验错误内联显示，Server Action 错误通过 toast

## 常用命令

```bash
pnpm dev          # 开发服务器
pnpm type-check   # 类型检查
pnpm lint         # ESLint 检查
pnpm test         # 运行测试
pnpm build        # 生产构建
```
