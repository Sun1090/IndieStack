/**
 * Vitest 测试配置文件
 * 双项目结构：node 环境（lib 单测 *.test.ts）+ jsdom 环境（组件测试 *.test.tsx）
 * 注意：projects 模式下 resolve.alias 需在每个项目内单独声明
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const alias = { "@": path.resolve(__dirname, "./src") };

export default defineConfig({
  plugins: [],
  test: {
    coverage: {
      provider: "v8",
      // 阈值门禁只约束核心业务逻辑；mock 数据 / Stripe / Supabase 客户端封装
      // 属于需要真实服务的集成胶水层，单测无法有效覆盖，不纳入统计
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/supabase/database.types.ts",
        "src/lib/mock/**",
        "src/lib/stripe/**",
        "src/lib/supabase/**",
      ],
      thresholds: {
        statements: 91,
        branches: 85,
        functions: 93,
        lines: 92,
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          globals: true,
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "docs-site", "src/**/*.dom.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          globals: true,
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "src/**/*.dom.test.ts"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
