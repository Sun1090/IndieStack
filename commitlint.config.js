/**
 * commitlint 配置
 * 规范 Git 提交信息格式，遵循 Conventional Commits 规范
 * 格式: type(scope?): subject
 * 示例: feat(auth): 添加 OAuth 登录功能
 *        fix(api): 修复用户查询分页问题
 *        docs: 更新部署文档
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
    "subject-case": [0], // 不限制大小写
    "subject-empty": [2, "never"],
    "type-empty": [2, "never"],
  },
};
