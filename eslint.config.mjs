// @ts-check

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

// eslint 配置：兼容 Next.js ESLint 插件规则
const eslintConfig = [
  // 忽略 .next 等构建输出目录
  { ignores: [".next/**", "dist/**", "out/**", "node_modules/**", "docs-site/.vitepress/dist/**", "docs-site/.vitepress/cache/**"] },
  // 兼容 next/core-web-vitals + eslint-config-next 规则
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
