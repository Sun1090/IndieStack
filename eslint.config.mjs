// @ts-check

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

// eslint 配置：兼容 Next.js ESLint 插件规则
const eslintConfig = [
  // 忽略 .next 等构建输出目录
  { ignores: [".next/**", "dist/**", "out/**", "node_modules/**", "coverage/**", "docs-site/.vitepress/dist/**", "docs-site/.vitepress/cache/**"] },
  // 兼容 next/core-web-vitals + eslint-config-next 规则
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // 复杂度门禁：圈复杂度超过 15 报错（新代码不允许继续恶化）
      complexity: ["error", { max: 15 }],
      "max-depth": ["warn", { max: 4 }],
    },
  },
  {
    // 技术债登记：存量高复杂度文件显式豁免（阈值放宽到 30），重构时逐个移除
    // 重构任务跟踪: docs/adr + 任务队列 #67 Result 类型统一
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
];

export default eslintConfig;
