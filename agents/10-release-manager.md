# 提交与发布管理 Agent

> 负责 IndieStack 项目的 Git 提交规范、分支管理、版本发布和部署验证。

## 提交规范

### Conventional Commits（commitlint 强制校验）

```
<type>(<scope>): <subject>

type 可选值：
  feat      新功能
  fix       缺陷修复
  docs      文档变更
  style     代码格式（不影响语义）
  refactor  重构（既非新增也非修复）
  perf      性能优化
  test      测试相关
  chore     构建/工具/依赖变更
  ci        CI 配置变更
```

- **subject** 用中文简述，不加句号，不超过 72 字符
- **scope** 使用模块名：`app` / `lib` / `ui` / `docs` / `deps` / `db` 等
- 示例：`fix(app): 消除 "use client" 指令前导空格`

### 提交前检查清单

- [ ] `pnpm check`（type-check + lint）通过
- [ ] `pnpm test` 全绿
- [ ] 涉及页面/配置的改动跑过 `pnpm build`
- [ ] 不包含密钥、`.env.local` 等敏感文件
- [ ] 只 stage 本次任务相关的文件

## 分支模型

| 分支 | 用途 | 保护 |
|------|------|------|
| `main` | 生产分支，push 触发 Vercel 生产部署 | ✅ 禁止 force push |
| `develop` | 集成分支，PR 目标默认分支 | ✅ |
| `feat/*` | 功能分支，从 develop 切出 | - |
| `fix/*` | 修复分支 | - |

## 发布流程

1. **本地验证**: `pnpm check && pnpm test && pnpm build`
2. **提交推送**: 按 Conventional Commits 提交，推送到对应分支
3. **CI 把关**: GitHub Actions（lint/type-check/test/build/docs 四道关卡）必须全绿
4. **生产部署**: push 到 main 后 Vercel 自动部署（App 与 Docs 两个项目）
5. **部署验证**（见下）

## 部署验证清单

```bash
# 1. 健康检查端点
curl -fsS https://<production-url>/api/health

# 2. 关键路由抽查（营销页 / 登录页 / dashboard 守卫重定向）
curl -sIo /dev/null -w '%{http_code}' https://<production-url>/

# 3. 安全头抽查（CSP 是否生效）
curl -sI https://<production-url>/ | grep -i content-security-policy
```

- [ ] `/api/health` 返回 200
- [ ] 首页 200、`/dashboard` 未登录时 307 → `/auth/login`
- [ ] CSP / X-Frame-Options 等安全头存在
- [ ] Sentry 无新上报的错误激增
- [ ] Vercel Dashboard 构建状态为 Ready 且无 skipped step

## 回滚预案

1. Vercel Dashboard → Deployments → 找上一个 Ready 的部署 → **Promote to Production**
2. 数据库变更不可回滚部署本身：涉及 migration 时先在 develop 分支的 preview 环境验证，确认后再合并 main
3. 紧急修复走 `fix/*` 分支快速通道，跳过 develop 直提 main（需 PR + 至少一人审查）

## 维护说明

- commitlint 规则见 `commitlint.config.js`，husky + lint-staged 在提交时自动执行
- 本 Agent 与 08-devops（基础设施）分工：08 管"环境与流水线怎么搭"，10 管"一次发布怎么做对"
