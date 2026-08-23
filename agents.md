# IndieStack Agents

> 项目智能助手体系 — 为 AI 协作提供专业化的角色定义和工作流程。
> 每个 Agent 专注于一个领域，遵循项目规范和最佳实践。

## 快速导航

| ID | Agent | 职责 | 文件 |
|----|-------|------|------|
| 01 | 代码编写 | 编写符合项目规范的高质量代码 | [agents/01-code-writer.md](./agents/01-code-writer.md) |
| 02 | 代码审查 | 审查代码质量、一致性和潜在问题 | [agents/02-code-reviewer.md](./agents/02-code-reviewer.md) |
| 03 | 项目审查 | 全面架构、配置和健康度审查 | [agents/03-project-auditor.md](./agents/03-project-auditor.md) |
| 04 | 架构师 | 架构设计、技术决策和演进规划 | [agents/04-architect.md](./agents/04-architect.md) |
| 05 | 测试工程师 | 测试策略、用例编写和维护 | [agents/05-test-engineer.md](./agents/05-test-engineer.md) |
| 06 | 文档编写 | 文档编写、维护和国际化 | [agents/06-documentation-writer.md](./agents/06-documentation-writer.md) |
| 07 | 数据库管理 | 数据库设计、迁移管理和数据安全 | [agents/07-dba.md](./agents/07-dba.md) |
| 08 | DevOps | 部署、CI/CD 和基础设施管理 | [agents/08-devops.md](./agents/08-devops.md) |
| 09 | UI/UX 设计 | 界面设计、组件规范和交互模式 | [agents/09-ui-ux.md](./agents/09-ui-ux.md) |
| 10 | 提交与发布 | 提交规范、分支管理、发布流程和部署验证 | [agents/10-release-manager.md](./agents/10-release-manager.md) |

## 使用场景

| 当你需要... | 调用 Agent |
|-------------|-----------|
| 添加新功能、编写代码 | [01 代码编写](./agents/01-code-writer.md) |
| 提交 PR 前做代码审查 | [02 代码审查](./agents/02-code-reviewer.md) |
| 全面检查项目健康度 | [03 项目审查](./agents/03-project-auditor.md) |
| 做架构决策或规划 | [04 架构师](./agents/04-architect.md) |
| 编写或维护测试 | [05 测试工程师](./agents/05-test-engineer.md) |
| 编写或更新文档 | [06 文档编写](./agents/06-documentation-writer.md) |
| 设计数据库或迁移 | [07 数据库管理](./agents/07-dba.md) |
| 配置部署或 CI/CD | [08 DevOps](./agents/08-devops.md) |
| 设计 UI 或组件 | [09 UI/UX 设计](./agents/09-ui-ux.md) |
| 提交、发布或验证部署 | [10 提交与发布](./agents/10-release-manager.md) |

## Agent 协作流程

```
需求输入 → 选择合适的 Agent → 执行任务 → 交叉审查 → 完成
```

1. **选择 Agent**: 根据任务类型从上方表格中选择对应的 Agent
2. **执行任务**: 按照 Agent 文档中的规范、流程和清单执行
3. **交叉审查**: 复杂任务完成后，调用相关 Agent 做交叉审查（如代码编写后调用代码审查）
4. **完成**: 确保测试通过、文档更新、提交代码

## 维护说明

- 新增 Agent 时，在此文件添加对应行并创建 `agents/{id}-{name}.md`
- 更新 Agent 时，同步更新此索引文件中的描述
- 所有 Agent 文档使用中文编写，保持约定的一致性

---

*最后更新: 2026-08-23**

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
