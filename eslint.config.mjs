// @ts-check

// eslint 配置：eslint-config-next 16 原生 flat config（不再需要 FlatCompat 桥接）
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";

const eslintConfig = defineConfig([
  // 忽略 .next 等构建输出目录
  {
    ignores: [
      ".next/**",
      // 并行 E2E 的每台 dev server 有自己的 distDir（见 playwright.config.ts 的 NEXT_DIST_DIR），
      // 里面是 Next 生成的 chunk，和被忽略的 .next 是同一类东西。
      ".next-e2e-*/**",
      "dist/**",
      "out/**",
      "node_modules/**",
      "coverage/**",
      "docs-site/.vitepress/dist/**",
      "docs-site/.vitepress/cache/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      // 复杂度门禁：圈复杂度超过 15 报错（新代码不允许继续恶化）
      complexity: ["error", { max: 15 }],
      "max-depth": ["warn", { max: 4 }],
    },
  },
  {
    // 技术债登记：存量高复杂度文件显式豁免（阈值放宽到 30），重构时逐个移除
    files: [
      "src/app/api/analytics/route.ts",
      "src/app/api/invitations/route.ts",
      "src/app/api/webhooks/stripe/route.ts",
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/profile/page.tsx",
      "src/components/shared/permission-gate.tsx",
      "src/lib/mock/index.ts",
      "src/lib/stripe/index.ts",
    ],
    rules: {
      complexity: ["error", { max: 30 }],
    },
  },
]);

export default eslintConfig;
