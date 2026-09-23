/**
 * commitlint 配置
 * 规范 Git 提交信息格式，遵循 Conventional Commits 规范
 * 格式: type(scope?): subject
 * 示例: feat(auth): 添加 OAuth 登录功能
 *        fix(api): 修复用户查询分页问题
 *        docs: 更新部署文档
 *
 * 注意：本仓库没有把 @commitlint/cli 装成依赖，也没有 commit-msg 钩子，所以这份规则
 * 目前是「登记在册、由 review 执行」，不是机器强制。要启用机器校验：
 * `pnpm add -D @commitlint/cli @commitlint/config-conventional`，再补一个
 * `.husky/commit-msg` 调 `pnpm exec commitlint --edit "$1"`——`pnpm check:hooks`
 * 会在依赖没装齐之前拒绝任何引用 commitlint 的钩子，免得再留下一个跑不了的钩子。
 */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",     // 新功能
        "fix",      // 修复 Bug
        "docs",     // 文档更新
        "style",    // 代码格式（不影响功能）
        "refactor", // 重构
        "perf",     // 性能优化
        "test",     // 测试
        "build",    // 构建系统
        "ci",       // CI/CD
        "chore",    // 杂项
        "revert",   // 回滚
      ],
    ],
    "scope-case": [2, "always", "lower-case"],
    // 常用 scope 枚举（软约束提示；不强制枚举以保留灵活性）
    "scope-enum": [
      1,
      "always",
      [
        "app",       // 页面/路由
        "lib",       // lib 工具与 actions
        "actions",   // server actions
        "auth",      // 认证
        "ui",        // 组件
        "api",       // API 路由
        "db",        // 数据库迁移
        "i18n",      // 国际化
        "deps",      // 依赖
        "docs",      // 文档站
        "e2e",       // E2E 测试
      ],
    ],
    "subject-case": [0], // 不限制大小写
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
  },
};
