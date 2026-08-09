export const SITE_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || "IndieStack",
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
    "A full-stack IndieStack for independent developers. Next.js, Tailwind, shadcn/ui, Supabase, PostgreSQL.",
  url: process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
  // OpenGraph image — 由 app/opengraph-image.tsx 自动生成动态图片，无需手动设置
  ogImage: "/og-image.png",
  author: "IndieStack",
  /** VitePress 独立文档站地址（可单独部署） */
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || "https://indiestack-docs.vercel.app",
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

  // API Keys
  apiKeys: "/dashboard/api-keys",
} as const;

export const API_ROUTES = {
  authCallback: "/api/auth/callback",
  user: "/api/user",
  upload: "/api/upload",
  webhooks: {
    stripe: "/api/webhooks/stripe",
  },
} as const;

export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    price: 0,
    priceId: "",
    features: [
      "Up to 3 projects",
      "Basic analytics",
      "Community support",
      "1 GB storage",
    ],
  },
  pro: {
    name: "Pro",
    price: 29,
    priceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
    features: [
      "Unlimited projects",
      "Advanced analytics",
      "Priority support",
      "50 GB storage",
      "Team up to 5 members",
      "API access",
    ],
  },
  enterprise: {
    name: "Enterprise",
    price: 99,
    priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "",
    features: [
      "Everything in Pro",
      "Unlimited team members",
      "Dedicated support",
      "500 GB storage",
      "Custom integrations",
      "SLA guarantee",
      "SSO / SAML",
    ],
  },
} as const;

export const ALIYUN_CONFIG = {
  bucket: process.env.ALIYUN_BUCKET ?? "",
  region: process.env.ALIYUN_REGION ?? "oss-cn-hangzhou",
  cdnDomain: process.env.ALIYUN_CDN_DOMAIN ?? "",
};

export const RATE_LIMIT = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};
