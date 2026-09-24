 # Auth Flow
 
 IndieStack uses Supabase Auth for a complete authentication system with multiple login methods and session management.
 
 ## Supported Methods
 
 | Method | Type | Description |
 |--------|------|-------------|
 | Email/Password | Native | Register, login, forgot/reset password with optional verification |
 | GitHub | OAuth | One-click login with auto profile fill |
 | Google | OAuth | One-click login with auto profile fill |
 
 ## Auth Page Routes
 
 | Path | Component | Description |
 |------|-----------|-------------|
 | `/auth/login` | `LoginForm` | Email + OAuth login |
 | `/auth/register` | `RegisterForm` | Email + OAuth registration |
 | `/auth/forgot-password` | `ForgotPasswordForm` | Send password reset email |
 | `/auth/reset-password` | `ResetPasswordForm` | Set new password |
 | `/auth/callback` | Callback | OAuth callback handler |
 
 ## Session Management
 
 Uses `@supabase/ssr` for SSR session handling:
 
 - **Cookie Storage**: Session stored in HttpOnly + Secure + SameSite cookies
 - **Auto-Refresh**: The proxy (`src/proxy.ts`) checks and refreshes expired sessions on each request
 - **Mock Mode**: With `NEXT_PUBLIC_MOCK_ENABLED=true`, skips real auth and uses `@faker-js/faker` mock data
 - **Route Protection**: Unauthenticated users visiting `/dashboard/*` are redirected to login
 
 ## Proxy Protection

 The proxy (`src/proxy.ts` — named "middleware" before Next 16) runs on every request:

 ```
 1. Generate a per-request CSP nonce and trace-id, inject them as request headers
 2. Refresh Supabase session (auto token refresh)
 3. Mock mode (`NEXT_PUBLIC_MOCK_ENABLED=true`) → skip all route protection
 4. Protected path + no user → redirect to /auth/login?redirect=original_path
 5. Logged-in user visiting /auth/* → redirect to /dashboard
 6. Otherwise continue with the user info
 ```

 Language is **not** handled here: `src/i18n/request.ts` reads the locale from the cookie, which keeps
 the proxy down to a single responsibility (session, route protection, CSP / trace headers).
 
 ## RBAC Integration
 
 Auth integrates with the RBAC permission system:
 
 ```typescript
 import { requireAuth, requireRole, requirePermission } from "@/lib/auth/guards";
 
 const user = await requireAuth(); // redirects if not logged in
 await requireRole("admin");       // requires admin role
 await requirePermission("team:invite"); // requires specific permission
 ```
 
 ## Server Component Auth
 
 ```typescript
 import { requireAuth } from "@/lib/auth/guards";
 
 export default async function DashboardPage() {
   const user = await requireAuth();
   return <div>Welcome, {user.email}</div>;
 }
 ```
 
 ## API Route Auth
 
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
 
 ## Client Auth Hook
 
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
 
 ## Mock Auth (Development)
 
 Set `NEXT_PUBLIC_MOCK_ENABLED=true` to develop without a real Supabase backend:
 
 - Mock user: `dev@indiestack.local`
 - All Auth APIs return mock success responses
 - The proxy skips session checks, returns mock user
 - Develop all dashboard pages without a database
