# 测试指南

> 项目测试体系总览。写代码前先读本文，选对测试层级。

## 测试金字塔

```
      E2E（Playwright，18 用例）        ← 关键路径冒烟
    ┌──────────────────────────┐
   │ 组件测试（jsdom + Testing Library）│ ← 交互组件
  │──────────────────────────────│
 │ 单元测试（Vitest node 环境，300+）  │ ← actions/工具/守卫
└────────────────────────────────┘
```

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm test` | 全部单元+组件测试 |
| `pnpm test:coverage` | 含覆盖率报告（核心逻辑门禁 ≥90%） |
| `pnpm test:e2e` | Playwright 冒烟（自动起 Mock dev server） |
| `pnpm verify` | check（类型/lint/i18n/rls/a11y/agents/docs）+ test + bundle 门禁 |
| `pnpm verify:all` | 上述全部校验聚合入口 |

## 双项目结构

vitest.config.ts 定义两个 project：

- **node**：`src/**/*.test.ts` — Server Actions、纯函数、路由处理器
- **jsdom**：`src/**/*.test.tsx` 与 `*.dom.test.ts` — 需要DOM 的组件

## 编写规范

1. 测试文件与源码同目录：`foo.ts` → `foo.test.ts`；组件 → `foo.test.tsx`
2. mock next-intl：`vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))`
3. Radix 组件需要 ResizeObserver —— 已在 `src/test/setup.ts` 全局 stub
4. Server Action 测试断言 ActionResult 形状：`{ ok: false, error: "key" }`

## 覆盖率门禁

`src/lib/**`（除 mock/stripe/supabase 客户端胶水层）：
statements/functions/lines ≥ 90%，branches ≥ 78%。CI 强制。

## E2E

- 运行于 Mock 模式（`NEXT_PUBLIC_MOCK_ENABLED=true`），无需真实 Supabase
- 新页面至少加一条"可渲染"断言到 `e2e/smoke.spec.ts`
- 安全头、trace-id、CSP nonce 断言集中在「安全与容错」组

## CI 门禁

push/PR 触发八道关卡：Lint & Type Check（含 i18n/RLS 校验）· Build · E2E · Build Docs · CodeQL · gitleaks。
任何一道失败即阻塞合并。
