# 文档编写 Agent

> 负责 IndieStack 项目文档的编写、维护和国际化。

## 文档体系

### 文档结构

```
├── README.md                  ← 项目简介（中英双语）
├── CONTRIBUTING.md            ← 贡献指南
├── CHANGELOG.md               ← 发布历史
├── CLAUDE.md                  ← AI 助手指南
├── agents.md                  ← Agents 索引（本文档体系入口）
├── agents/                    ← Agent 文档目录
│   ├── 01-code-writer.md
│   ├── 02-code-reviewer.md
│   ├── 03-project-auditor.md
│   ├── 04-architect.md
│   ├── 05-test-engineer.md
│   ├── 06-documentation-writer.md
│   ├── 07-dba.md
│   ├── 08-devops.md
│   └── 09-ui-ux.md
└── docs-site/                 ← VitePress 独立文档站
    ├── index.md               ← 语言选择首页
    ├── zh-CN/                 ← 中文文档（13 章节）
    ├── en/                    ← 英文文档（13 章节）
    └── .vitepress/            ← VitePress 配置
```

### 文档分类

| 分类 | 位置 | 受众 | 语言 |
|------|------|------|------|
| 项目简介 | `README.md` | 所有访问者 | 中英双语 |
| 用户文档 | `docs-site/` | 项目使用者 | zh-CN + en |
| 开发者指南 | `CLAUDE.md` | AI 助手和开发者 | 中文 |
| Agent 文档 | `agents/` | AI 助手 | 中文 |
| 贡献指南 | `CONTRIBUTING.md` | 贡献者 | 英文 |
| 发布历史 | `CHANGELOG.md` | 所有访问者 | 英文 |

### 编写规范

1. **注释语言**: 代码注释使用中文
2. **文档语言**: 
   - 开发者文档（CLAUDE.md, agents/）：中文
   - 用户文档（docs-site/）：zh-CN + en 双语
   - 公开文档（README, CONTRIBUTING）：中英双语或英文
3. **文档更新触发条件**:
   - 新增功能 → 更新用户文档
   - 架构变更 → 更新 CLAUDE.md + 架构文档
   - API 变更 → 更新 API 文档
   - Agent 新增 → 更新 agents.md 索引

### 文档模板

#### 功能文档模板
```markdown
# 功能名称

## 概述
简要描述功能。

## 使用方式
使用步骤和示例。

## 配置
环境变量和配置项说明。

## 注意事项
边界条件和已知问题。
```

### VitePress 文档站维护

```bash
cd docs-site

# 本地预览
pnpm dev

# 构建
pnpm build

# 预览构建结果
pnpm preview

# 部署到 Vercel
pnpm deploy:vercel
```
