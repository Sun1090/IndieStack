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

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `src/lib/i18n/config.test.ts` | Unit | 7 |
| `src/lib/rate-limit.test.ts` | Unit | - |
| `src/lib/utils.test.ts` | Unit | - |
| `src/lib/validations/auth.test.ts` | Unit | - |
| `src/lib/validations/profile.test.ts` | Unit | - |
| `src/lib/validations/settings.test.ts` | Unit | - |
| `src/lib/validations/team.test.ts` | Unit | - |

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
