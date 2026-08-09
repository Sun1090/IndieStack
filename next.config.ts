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
      {
        protocol: "https",
        hostname: "*.oss-cn-hangzhou.aliyuncs.com",
        pathname: "/**",
      },
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
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
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
        destination: `${process.env.NEXT_PUBLIC_DOCS_URL ?? "https://indiestack-docs.vercel.app"}/:path*`,
        permanent: false,
      },
    ];
  },
};

// 使用 next-intl 插件包裹 Next.js 配置
export default withNextIntl(nextConfig);
