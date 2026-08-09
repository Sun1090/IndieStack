# 配置指南

## 核心环境变量

### 必需配置

| 变量名 | 说明 | 获取方式 |
|--------|------|---------|
| `NEXT_PUBLIC_APP_URL` | 应用部署 URL（开发环境为 `http://localhost:3000`） | 自行填写 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名 Key | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务角色 Key（仅服务端使用） | Supabase Dashboard → Settings → API |
| `SUPABASE_DB_URL` | Supabase 数据库连接字符串 | Supabase Dashboard → Settings → Database |

```bash
# 必需 — 启动最低配置
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_DB_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

### Mock 模式

```bash
# 开发 Mock 模式：设为 true 可无需 Supabase 环境变量即可本地开发
NEXT_PUBLIC_MOCK_ENABLED=true
```

### 监控（推荐）

| 变量名 | 说明 | 获取方式 |
|--------|------|---------|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN | Sentry Dashboard → 项目设置 |
| `SENTRY_ORG` | Sentry 组织名 | Sentry Dashboard |
| `SENTRY_PROJECT` | Sentry 项目名 | Sentry Dashboard |
| `SENTRY_AUTH_TOKEN` | Sentry 认证 Token | Sentry Dashboard → Auth Tokens |
| `NEXT_PUBLIC_APPARK_API_KEY` | Appark APM API Key | Appark Dashboard |

```bash
# Sentry 错误追踪
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-auth-token

# Appark 应用监控
NEXT_PUBLIC_APPARK_API_KEY=your-api-key
```

### 文件存储（阿里云 OSS）

| 变量名 | 说明 | 获取方式 |
|--------|------|---------|
| `ALIYUN_ACCESS_KEY_ID` | 阿里云 AccessKey ID | 阿里云 RAM 控制台 |
| `ALIYUN_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret | 阿里云 RAM 控制台 |
| `ALIYUN_BUCKET` | OSS Bucket 名称 | OSS 控制台 |
| `ALIYUN_REGION` | OSS 区域（默认 `oss-cn-hangzhou`） | OSS 控制台 |
| `ALIYUN_CDN_DOMAIN` | CDN 加速域名（可选） | CDN 控制台 |

```bash
# 阿里云 OSS
ALIYUN_ACCESS_KEY_ID=your-key
ALIYUN_ACCESS_KEY_SECRET=your-secret
ALIYUN_BUCKET=your-bucket
ALIYUN_REGION=oss-cn-hangzhou
ALIYUN_CDN_DOMAIN=https://static.yourdomain.com
```

### 支付（Stripe）

| 变量名 | 说明 | 获取方式 |
|--------|------|---------|
| `STRIPE_SECRET_KEY` | Stripe 密钥（以 `sk_` 开头） | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Webhook 签名密钥（以 `whsec_` 开头） | Stripe Dashboard → Developers → Webhooks |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 可发布密钥（以 `pk_` 开头） | Stripe Dashboard → Developers → API Keys |
| `STRIPE_PRO_PRICE_ID` | Pro 方案价格 ID | Stripe Dashboard → Products |
| `STRIPE_ENTERPRISE_PRICE_ID` | Enterprise 方案价格 ID | Stripe Dashboard → Products |

```bash
# Stripe 支付
STRIPE_SECRET_KEY=sk_test_xxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxx
STRIPE_PRO_PRICE_ID=price_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_enterprise_monthly
```

### 部署（Vercel / GitHub Actions）

```bash
# Vercel
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id

# GitHub Actions
GITHUB_TOKEN=your-github-token
```

## 应用常量配置

核心配置集中在 `src/lib/constants.ts`，包括：

### `SITE_CONFIG` — 站点基本信息

```typescript
export const SITE_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "IndieStack",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
    "A full-stack IndieStack for independent developers. Next.js, Tailwind, shadcn/ui, Supabase, PostgreSQL.",
  url: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || "https://indiestack-docs.vercel.app",
  // ...
};
```

### `AUTH_CONFIG` — 认证配置

```typescript
export const AUTH_CONFIG = {
  providers: ["email", "github", "google"] as const,
  redirectAfterLogin: "/dashboard",
  redirectAfterLogout: "/",
};
```

支持的认证提供商：`email`（邮箱密码）、`github`、`google`、`wechat`（微信）、`apple`。

### `ROUTES` — 路由映射

集中管理所有路由路径，修改路由时只需修改此文件：

- 营销页面：`/features`、`/pricing`、`/about`、`/blog`、`/faq` 等
- 认证页面：`/auth/login`、`/auth/register`、`/auth/forgot-password` 等
- 仪表盘：`/dashboard`、`/dashboard/analytics`、`/dashboard/team` 等
- 管理后台：`/dashboard/admin`、`/dashboard/admin/users` 等
- 文档：指向独立 VitePress 文档站（`NEXT_PUBLIC_DOCS_URL`）

### `SUBSCRIPTION_TIERS` — 订阅方案

```typescript
export const SUBSCRIPTION_TIERS = {
  free: { name: "Free", price: 0, features: ["3 个项目", "基础分析"] },
  pro: { name: "Pro", price: 29, features: ["无限项目", "高级分析"] },
  enterprise: { name: "Enterprise", price: 99, features: ["无限成员", "专属支持"] },
};
```

### `RATE_LIMIT` — 速率限制

```typescript
export const RATE_LIMIT = {
  maxRequests: 100,    // 每分钟最大请求数
  windowMs: 60 * 1000, // 窗口大小（1 分钟）
};
```

## 主题配置

### Tailwind CSS

`tailwind.config.ts` 中配置了自定义颜色和 CSS 变量：

```typescript
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        // ...
      },
    },
  },
};
```

### CSS 变量

`src/app/globals.css` 中统一管理深浅色主题的 CSS 变量：

```css
@layer base {
  :root { /* 浅色主题变量 */ }
  .dark { /* 深色主题变量 */ }
}
```

## i18n 配置

多语言配置位于 `src/i18n/routing.ts`：

```typescript
export const routing = defineRouting({
  locales: ["zh-CN", "en"],
  defaultLocale: "zh-CN",
  localePrefix: "never",
});
```

- 语言偏好存储在 Cookie 中（`app-locale`），有效期 1 年
- 翻译文件按命名空间拆分为 `messages/{locale}/{namespace}.json`（如 `messages/zh-CN/common.json`）
- 服务端使用 `getTranslations(namespace)` from `next-intl/server`
- 客户端使用 `useTranslations(namespace)` from `next-intl`

## 权限与角色配置

权限系统位于 `src/lib/auth/`：

| 文件 | 作用 |
|------|------|
| `permissions.ts` | 定义 28 个权限常量，按域分组 |
| `roles.ts` | 定义 4 个角色（super_admin / admin / member / viewer），角色-权限映射 |
| `guards.ts` | 路由守卫：requireAuth()、requireRole()、requirePermission() |

## 完整配置示例

```bash
# ===== 必需 =====
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...

# ===== 开发 Mock =====
NEXT_PUBLIC_MOCK_ENABLED=true

# ===== 监控 =====
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project

# ===== 文件存储 =====
ALIYUN_ACCESS_KEY_ID=your-key
ALIYUN_ACCESS_KEY_SECRET=your-secret
ALIYUN_BUCKET=your-bucket
ALIYUN_REGION=oss-cn-hangzhou
ALIYUN_CDN_DOMAIN=https://static.yourdomain.com

# ===== 支付 =====
STRIPE_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_PRO_PRICE_ID=price_pro_monthly
STRIPE_ENTERPRISE_PRICE_ID=price_enterprise_monthly

# ===== 部署 =====
VERCEL_TOKEN=your-vercel-token
VERCEL_ORG_ID=your-org-id
VERCEL_PROJECT_ID=your-project-id
VERCEL_DOCS_PROJECT_ID=your-docs-project-id
GITHUB_TOKEN=your-github-token

# ===== APM =====
NEXT_PUBLIC_APPARK_API_KEY=your-api-key
```
