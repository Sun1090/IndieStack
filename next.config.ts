/**
 * Next.js 配置文件
 * 集成 next-intl 国际化插件、图片优化、安全头和重定向规则
 */
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// 指定 next-intl 请求配置文件路径（采用 Cookie 方案，无 URL 前缀）
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // OSS 为规划中/未接线（见 docs/architecture/11-integrations.md），域名白名单暂不预留
      {
        protocol: "https",
        hostname: "*.vercel-storage.com",
        pathname: "/**",
      },
    ],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },

  async headers() {
    // CSP 说明：
    // - script-src 需 'unsafe-inline'/'unsafe-eval'：Next.js 水合内联脚本与开发模式 HMR
    // - connect-src 覆盖 Supabase（REST/Auth/Realtime）与 Sentry 客户端上报
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https://*.supabase.co",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      {
        source: "/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/home",
        destination: "/",
        permanent: true,
      },
      {
        source: "/docs/:path*",
        destination: `${process.env.NEXT_PUBLIC_DOCS_URL ?? "https://indie-stack-docs-site.vercel.app"}/:path*`,
        permanent: false,
      },
    ];
  },
};

// 使用 next-intl 插件包裹 Next.js 配置
export default withNextIntl(nextConfig);
