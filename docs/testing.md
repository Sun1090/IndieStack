# 测试指南

> 项目测试体系总览。写代码前先读本文，选对测试层级。

## 测试金字塔

```
      E2E（Playwright，50 用例）        ← 关键路径冒烟
    ┌──────────────────────────┐
   │ 组件测试（jsdom + Testing Library）│ ← 交互组件
  │──────────────────────────────│
 │ 单元测试（Vitest node 环境，300+）  │ ← actions/工具/守卫
└────────────────────────────────┘
```

## 命令

| 命令                                 | 说明                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `pnpm test`                          | 全部单元+组件测试                                                               |
| `pnpm test:coverage`                 | 含覆盖率报告（核心逻辑门禁 ≥90%）                                               |
| `pnpm test:e2e`                      | Playwright 冒烟（自动起 Mock dev server）                                       |
| `pnpm smoke:supabase-identity`       | 本地/staging Supabase 真实身份矩阵（anon/authenticated/service_role + Storage） |
| `pnpm verify`                        | check（类型/lint/i18n/rls/a11y/agents/docs）+ test + bundle 门禁                |
| `pnpm check:all` / `pnpm verify:all` | 上述全部校验聚合入口（两个命令同义）                                            |

## 双项目结构

vitest.config.ts 定义两个 project：

- **node**：`src/**/*.test.ts` — Server Actions、纯函数、路由处理器
- **jsdom**：`src/**/*.test.tsx` 与 `*.dom.test.ts` — 需要DOM 的组件

Vitest 每个项目最多 2 个 worker，避免本机高并发创建 jsdom 导致交互测试超时。

## 编写规范

1. 测试文件与源码同目录：`foo.ts` → `foo.test.ts`；组件 → `foo.test.tsx`
2. mock next-intl：`vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))`
3. Radix 组件需要 ResizeObserver —— 已在 `src/test/setup.ts` 全局 stub
4. Server Action 测试断言 ActionResult 形状：`{ ok: false, error: "key" }`

## 覆盖率门禁

`src/lib/**`（除 mock/stripe/supabase 客户端胶水层）：
statements/functions/lines ≥ 90%，branches ≥ 90%。CI 强制。

## E2E

- 运行于 Mock 模式（`NEXT_PUBLIC_MOCK_ENABLED=true`），无需真实 Supabase
- 默认单 worker 串行执行，避免多个 spec 通过同一个 dev server 互相清理/覆盖可变 Mock 状态；仅隔离实验可设置 `PW_FULLY_PARALLEL=true`
- 新页面至少加一条"可渲染"断言到 `e2e/smoke.spec.ts`
- 安全头、trace-id、CSP nonce 断言集中在「安全与容错」组
- `e2e/a11y.spec.ts` 使用 `@axe-core/playwright` 对首页、功能页、定价页、登录页、注册页执行 WCAG 2.1 A/AA 自动审计；新增或修改公共页面时必须同步评估覆盖范围
- 语言切换同时覆盖 Cookie 持久化与键盘操作：Tab 聚焦触发按钮、Enter 打开菜单、`aria-current` 标识当前语言、Escape 关闭并归还焦点

## 数据库身份矩阵（本地 Supabase）

`pnpm smoke:supabase-identity` 是**真实运行时**回归，不是静态检查：它登录 `seed.sql`
里的确定性账号，用 anon / authenticated / service_role 三种身份打 PostgREST 与 Storage
API，验证租户隔离、`profiles` 可见范围、私有项目不可读，以及 `avatars` 前缀写权限。

前置条件：

```bash
pnpm exec supabase start
pnpm exec supabase db reset        # 24 个迁移 + seed
pnpm smoke:supabase-identity -- --output /tmp/indiestack-identity-matrix.json
```

- 只有在本地/staging 才运行：seed 账号密码是公开固定值。
- 可用 `--url` / `--anon-key` / `--service-role-key` 覆盖目标（例如受控 staging）。
- 脚本结束时清理自己创建的临时对象；失败项会在 JSON 的 `checks[].passed=false` 中列出。
- 覆盖范围与局限见 [db/security-audit.md](./db/security-audit.md)。

## CI 门禁

push/PR 触发八道关卡：Lint & Type Check（含 i18n/RLS 校验）· Build · E2E · Build Docs · CodeQL · gitleaks。
任何一道失败即阻塞合并。

## Mock fixture 隔离策略（F02/F03）

默认 E2E 不使用 file-backed fixture。Playwright 的浏览器测试与 Next.js dev server 可能跨 worker、跨模块 chunk 运行；把可变 fixture 写入仓库文件会带来并发覆盖、残留状态、工作区污染和 CI artifact 泄露风险，也无法保证多个 server worker 看到同一份原子状态。

推荐按以下优先级选择状态容器：

1. **request-scoped store**：需要并行请求彼此隔离时，使用 `createMockRequestStore()` 创建 scope，并把它注入 mock adapter/client。
2. **globalThis mock cache**：仅用于现有 dev server 的跨 chunk 闭环；测试必须通过受保护的 reset endpoint 或 `resetMockCache()` 清理。
3. **file-backed fixture（仅离线快照）**：只允许用于只读、脱敏的 fixture 生成/调试，不作为运行时数据库，不从用户输入写入，不提交包含 token、cookie、邮件正文或个人数据的文件。

F03 评估结论：运行时 file-backed fixture 暂不引入；request-scoped store 解决隔离问题且不增加 IO/锁语义。若未来需要跨进程复现，必须单独设计临时目录、原子 rename、worker 唯一命名、TTL 清理和 CI artifact 脱敏校验。

## 发布文档门禁

`pnpm check:release-docs` 校验发布 checklist、发布/回滚 runbook、生产 smoke 矩阵、CHANGELOG 和双语 README 的关键内容与命令。它只证明文档产物结构完整，不证明生产部署、冒烟或回滚演练已经执行；这些必须附带实际命令输出和时间记录。
