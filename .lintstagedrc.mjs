/**
 * lint-staged 配置
 * 在 Git commit 前对暂存文件自动执行 lint 和格式化
 */
const config = {
  "*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write",
  ],
  "*.{css,scss,json,md}": [
    "prettier --write",
  ],
};

export default config;
