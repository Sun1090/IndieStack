 # 认证流程
 
 IndieStack 使用 Supabase Auth 提供完整的认证体系，支持多种登录方式与会话管理。
 
 ## 支持的认证方式
 
 | 方式 | 类型 | 说明 |
 |------|------|------|
 | 邮箱密码 | 原生 | 注册、登录、找回密码、重置密码，验证码可选 |
 | GitHub | OAuth | 一键登录，自动填充用户资料 |
 | Google | OAuth | 一键登录，自动填充用户资料 |
 
 ## 认证页面路由
 
 | 路径 | 组件 | 说明 |
 |------|------|------|
 | `/auth/login` | `LoginForm` | 邮箱 + OAuth 登录 |
 | `/auth/register` | `RegisterForm` | 邮箱注册 + OAuth 注册 |
 | `/auth/forgot-password` | `ForgotPasswordForm` | 发送密码重置邮件 |
 | `/auth/reset-password` | `ResetPasswordForm` | 设置新密码 |
 | `/auth/callback` | Callback | OAuth 回调处理，完成会话建立 |
 
 ## 会话管理
 
 项目使用 `@supabase/ssr` 包实现服务端渲染会话管理：
 
 - **Cookie 存储**: Session 信息存储在 HttpOnly + Secure + SameSite Cookie 中
 - **自动刷新**: Middleware 在每个请求中自动检查并刷新过期会话
 - **Mock 模式**: 开发环境下 `NEXT_PUBLIC_MOCK_ENABLED=true` 时跳过真实认证，使用 `@faker-js/faker` 生成模拟用户数据
 - **未认证保护**: 未登录用户访问 `/dashboard/*` 自动重定向到登录页
 
 ## 中间件保护逻辑
 
 中间件（`src/middleware.ts`）在每个请求中执行以下流程：
 
 ```
 1. 检测用户浏览器语言偏好 → 设置语言 Cookie
 2. 刷新 Supabase 会话（自动处理 Token 刷新）
 3. 检查请求路径是否匹配受保护路由
 4. 未认证 → 重定向到 /auth/login?redirect=原路径
 5. 已认证 → 继续请求，传递用户信息
 6. 已登录用户访问 /auth/login 或 /auth/register → 重定向到 /dashboard
 ```
 
 ```typescript
 // src/middleware.ts 核心逻辑
 import { updateSession } from "@/lib/supabase/middleware";
 
 export async function middleware(request: NextRequest) {
   const { supabaseResponse, user } = await updateSession(request);
   if (isProtectedRoute(pathname) && !user) {
     const loginUrl = new URL(ROUTES.login, request.url);
     loginUrl.searchParams.set("redirect", pathname);
     return NextResponse.redirect(loginUrl);
   }
   return supabaseResponse;
 }
 ```
 
 ## 数据模型 - profiles 表
 
 用户注册时通过数据库触发器自动创建 `profiles` 记录：
 
 ```sql
 create table public.profiles (
   id          uuid primary key references auth.users(id) on delete cascade,
   email       text,
   full_name   text,
   avatar_url  text,
   role        text not null default 'user' check (role in ('user', 'admin')),
   created_at  timestamptz not null default now(),
   updated_at  timestamptz not null default now()
 );
 
 -- 自动创建 profile 的触发器
 create function public.handle_new_user()
 returns trigger as $$
 begin
   insert into public.profiles (id, email, full_name, avatar_url)
   values (new.id, new.email, new.raw_user_meta_data ->> 'full_name',
           new.raw_user_meta_data ->> 'avatar_url');
   return new;
 end;
 $$ language plpgsql;
 
 create trigger on_auth_user_created
   after insert on auth.users
   for each row execute function public.handle_new_user();
 ```
 
 ## RBAC 权限集成
 
 认证系统与 RBAC 权限系统深度集成：
 
 ```typescript
 import { requireAuth, requireRole, requirePermission } from "@/lib/auth/guards";
 
 const user = await requireAuth(); // 自动重定向未登录用户
 await requireRole("admin");       // 要求 admin 角色
 await requirePermission("team:invite"); // 要求具体权限
 ```
 
 ## 服务端认证（路由守卫）
 
 ```typescript
 import { requireAuth } from "@/lib/auth/guards";
 
 export default async function DashboardPage() {
   const user = await requireAuth();
   return <div>欢迎, {user.email}</div>;
 }
 ```
 
 ## API 路由认证
 
 ```typescript
 import { safelyRequireAuth } from "@/lib/auth/guards";
 
 export async function GET(request: Request) {
   const result = await safelyRequireAuth();
   if (!result.success) {
     return Response.json(
       { error: result.error.message },
       { status: result.error.code === "UNAUTHORIZED" ? 401 : 403 }
     );
   }
 }
 ```
 
 ## 客户端认证（React Hooks）
 
 ```tsx
 "use client";
 import { useUser } from "@/hooks/use-user";
 
 function UserProfile() {
   const { user, loading } = useUser();
   if (loading) return <Skeleton className="h-10 w-10 rounded-full" />;
   if (!user) return <LoginButton />;
   return <Avatar>{user.email?.charAt(0)}</Avatar>;
 }
 ```
 
 ## 开发模式（Mock Auth）
 
 设置 `NEXT_PUBLIC_MOCK_ENABLED=true` 后，无需真实 Supabase 后端即可完整模拟认证流程：
 
 - 固定模拟用户：`dev@indiestack.local`
 - 所有 Auth API 返回模拟成功响应
 - Middleware 跳过实际会话检查，返回 Mock 用户
 - 无需数据库即可开发仪表盘所有页面
