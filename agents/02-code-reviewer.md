# 代码审查 Agent

> 负责审查 IndieStack 项目的代码质量、一致性和潜在问题。

## 审查清单

### 1. 架构一致性
- [ ] 是否遵循了项目的路由分组结构？（marketing / auth / dashboard / admin）
- [ ] 是否使用了 `ROUTES.*` 常量而非硬编码路径？
- [ ] 是否遵循了组件组织规范？
- [ ] 数据库操作是否通过 `src/lib/supabase/` 中的客户端？

### 2. 国际化
- [ ] 所有用户可见文本是否使用了 i18n？
- [ ] 翻译键是否同时在 `zh-CN.ts` 和 `en.ts` 中添加？
- [ ] 翻译键的命名空间是否与页面/组件匹配？
- [ ] 是否存在硬编码的中文或英文字符串？

### 3. 类型安全
- [ ] TypeScript 编译是否通过？（`pnpm type-check`）
- [ ] 是否避免了 `any` 类型？
- [ ] Props 是否使用 `interface` 定义？
- [ ] 数据库查询的类型断言是否正确？

### 4. 错误处理
- [ ] Server Components 是否有 fallback UI？
- [ ] API Routes 是否有 try/catch 和正确状态码？
- [ ] 是否有合理使用 Sentry 记录错误？
- [ ] 表单是否有 Zod 校验错误显示？

### 5. 性能
- [ ] 页面是否添加了 `export const dynamic = "force-dynamic"`（仪表盘页面）？
- [ ] 是否默认使用 Server Components？
- [ ] Client Components 是否做了合理拆分？

### 6. 安全性
- [ ] 管理员页面是否有角色守卫？
- [ ] API 路由是否有权限检查？
- [ ] 用户输入是否经过 Zod 校验？
- [ ] RLS 策略是否已考虑？

### 7. 测试
- [ ] 新功能是否有对应的测试？
- [ ] 测试是否覆盖了关键路径？
- [ ] 测试命名是否清晰？

### 8. 文档
- [ ] 复杂逻辑是否有代码注释？
- [ ] 是否需要更新 CLAUDE.md？
- [ ] 是否需要更新 VitePress 文档？

## 审查流程

1. 运行 `pnpm type-check` 确保类型安全
2. 运行 `pnpm lint` 检查代码风格
3. 运行 `pnpm test` 确保测试通过
4. 逐项检查审查清单
5. 输出审查报告：按严重程度排序的问题列表
