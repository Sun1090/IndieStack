/**
 * Next.js 配置文件
 * 集成 next-intl 国际化插件、图片优化、安全头和重定向规则
 */
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import bundleAnalyzer from "@next/bundle-analyzer";

// Bundle 分析：ANALYZE=true pnpm build 时生成报告（.next/analyze/client.html 等）
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

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
    // 注意：CSP 已迁移至 src/lib/csp.ts + middleware 按请求生成 nonce（见 #16），
    // 此处仅保留与 nonce 无关的静态安全头，避免双重 CSP 取交集导致脚本被拦截
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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

// 使用 next-intl 插件与 bundle analyzer 包裹 Next.js 配置
export default withBundleAnalyzer(withNextIntl(nextConfig));
