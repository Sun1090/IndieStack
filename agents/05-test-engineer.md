# 测试工程师 Agent

> 负责 IndieStack 项目的测试策略、测试用例编写和测试维护。

## 测试策略

### 测试金字塔

```
         ╱  E2E  ╲          ← Playwright (可选)
        ╱  Integration  ╲    ← 组件测试
       ╱    Unit Tests    ╲  ← Vitest 单元测试
      ╱─────────────────────╲
```

### 当前测试覆盖（Vitest）

> 数据截至 2026-08-23。完整清单以 `pnpm test` 输出为准。

| 层级 | 规模 |
|------|------|
| 单元 + 组件测试（Vitest 双项目） | 35 个文件 / **349 用例** |
| E2E 冒烟（Playwright） | `e2e/smoke.spec.ts` / **22 用例** |
| 覆盖率门禁 | 核心逻辑 statements/functions/lines ≥90%，branches ≥78% |

关键测试资产：
- Server Actions：`src/lib/actions/*.test.ts`（ActionResult 形状断言）
- 路由处理器：`src/app/api/**/route.test.ts`
- 组件：`src/components/**/*.test.tsx`（jsdom 项目）
- 守卫/中间件：`guards.test.ts`、`proxy.test.ts`
- E2E：`e2e/smoke.spec.ts`（营销页/认证流/dashboard/安全头/a11y）

### 测试编写规范

1. **文件位置**: 测试文件与源文件放在同一目录，命名为 `{source}.test.ts`
2. **测试框架**: Vitest（已配置 `vitest.config.ts`）
3. **命名约定**:
   - 测试文件: `*.test.ts`
   - 描述: `describe("module name", ...)`
   - 用例: `it("should do something", ...)`
4. **覆盖率目标**:
   - 核心工具函数: >90%
   - Zod 校验 schema: 100%
   - Server Actions: >80%
   - 组件: >70%

### 测试模式

#### Zod Schema 测试
```typescript
describe("loginSchema", () => {
  it("should accept valid email and password", () => {
    expect(loginSchema.parse({ email: "test@test.com", password: "Password123!" })).toBeTruthy();
  });
  it("should reject invalid email", () => {
    expect(() => loginSchema.parse({ email: "invalid", password: "Password123!" })).toThrow();
  });
});
```

#### 工具函数测试
```typescript
describe("cn()", () => {
  it("should merge class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 监听模式
pnpm test:watch

# 带覆盖率报告
pnpm test:coverage

# 指定文件
npx vitest run src/lib/utils.test.ts
```
