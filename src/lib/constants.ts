export const SITE_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "IndieStack",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
    "A full-stack IndieStack for independent developers. Next.js, Tailwind, shadcn/ui, Supabase, PostgreSQL.",
  // 生产环境兜底为实际部署域名（Vercel 未配置 NEXT_PUBLIC_APP_URL 时 sitemap/OG 仍指向正确地址）；
  // 开发环境保持 localhost
  url:
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.NODE_ENV === "production"
      ? "https://indie-stack-theta.vercel.app"
      : "http://localhost:3000"),
  author: "IndieStack",
  /** 联系邮箱（可在部署时通过 NEXT_PUBLIC_CONTACT_EMAIL 覆盖） */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "hello@indiestack.dev",
  /** VitePress 独立文档站地址（可单独部署） */
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || "https://indie-stack-docs-site.vercel.app",
  links: {
    github: "https://github.com/your-username/indiestack",
    twitter: "https://twitter.com/your-handle",
  },
};

export const AUTH_CONFIG = {
  /**
   * Define which authentication providers are enabled.
   * Supported: "email", "github", "google", "wechat", "apple"
   */
  providers: ["email", "github", "google"] as const,
  redirectAfterLogin: "/dashboard",
  redirectAfterLogout: "/",
};

export const ROUTES = {
  // Public
  home: "/",
  features: "/features",
  changelog: "/changelog",
  faq: "/faq",
  pricing: "/pricing",
  about: "/about",
  blog: "/blog",
  privacy: "/privacy",
  terms: "/terms",
  contact: "/contact",

  // Docs（指向独立 VitePress 文档站）
  docs: SITE_CONFIG.docsUrl,

  // Auth
  login: "/auth/login",
  register: "/auth/register",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",

  // Dashboard
  dashboard: "/dashboard",
  dashboardAnalytics: "/dashboard/analytics",
  dashboardProfile: "/dashboard/profile",
  dashboardProfileEdit: "/dashboard/profile/edit",
  dashboardSettings: "/dashboard/settings",
  dashboardTeam: "/dashboard/team",
  dashboardTeamInvite: "/dashboard/team/invite",
  dashboardTeamCreate: "/dashboard/team/create",
  dashboardProjects: "/dashboard/projects",
  dashboardProjectsNew: "/dashboard/projects/new",
  dashboardNotifications: "/dashboard/notifications",
  dashboardIntegrations: "/dashboard/integrations",
  dashboardBilling: "/dashboard/billing",
  // Admin
  admin: "/dashboard/admin",
  adminUsers: "/dashboard/admin/users",
  adminAuditLogs: "/dashboard/admin/audit-logs",
  adminWebhooks: "/dashboard/admin/webhooks",
  adminMessages: "/dashboard/admin/messages",

  // API Keys
  apiKeys: "/dashboard/api-keys",
} as const;

export const API_ROUTES = {
  authCallback: "/api/auth/callback",
  user: "/api/user",
  uploads: {
    avatar: "/api/uploads/avatar",
    projectCover: "/api/uploads/project-cover",
  },
  webhooks: {
    stripe: "/api/webhooks/stripe",
  },
} as const;

export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    price: 0,
    priceId: "",
    features: ["upTo3Projects", "basicAnalytics", "communitySupport", "storage1Gb"],
  },
  pro: {
    name: "Pro",
    price: 29,
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
    features: [
      "unlimitedProjects",
      "advancedAnalytics",
      "prioritySupport",
      "storage50Gb",
      "teamUpTo5",
      "apiAccess",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 99,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "",
    features: [
      "everythingInPro",
      "unlimitedTeamMembers",
      "dedicatedSupport",
      "storage500Gb",
      "customIntegrations",
      "slaGuarantee",
      "ssoSaml",
    ],
  },
} as const;

/**
 * 角色与语言的权威取值集合。
 *
 * 这些枚举此前只以字符串字面量散落在各页面里（`["member", "admin", "viewer"]`、
 * `t(`users.roleLabels.${role}`)`），而 `check:i18n` 按设计不扫动态模板，
 * 所以「新增一个角色但忘了加翻译」不会有任何门禁报警。`pnpm check:dynamic-keys`
 * 以这里为唯一事实源来校验 `*.roles.*` / `*.roleLabels.*` 的键集合。
 */

/** 系统角色（账户 `profiles.role`）：`super_admin` 只读展示，不可从界面授予。 */
export const SYSTEM_ROLES = ["super_admin", "admin", "member", "viewer"] as const;

/** 管理员在用户表里可以改成的角色（刻意不含 `super_admin`）。 */
export const ASSIGNABLE_USER_ROLES = ["member", "admin", "viewer"] as const;

/** 团队角色（`team_members.role`）。 */
export const TEAM_ROLES = ["owner", "admin", "member", "viewer"] as const;

/** 个人资料里展示的语言偏好取值（与站点 locale 不是一回事）。 */
export const PROFILE_LANGUAGES = ["en", "zh", "ja", "ko"] as const;

export const RATE_LIMIT = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};
