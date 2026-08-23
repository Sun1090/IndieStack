#!/usr/bin/env bash
# 聚合校验入口：翻译对称性 + Agent 索引 + RLS 迁移 + 文档同步 + 代码检查 + 测试
set -euo pipefail
cd "$(dirname "$0")/.."
echo "==> check:locales"; pnpm --silent check:locales
echo "==> check:agents"; pnpm --silent check:agents
echo "==> check:rls";    pnpm --silent check:rls
echo "==> check:docs";   pnpm --silent check:docs
echo "==> type-check";   pnpm --silent type-check
echo "==> lint";         pnpm --silent lint
echo "==> test";         pnpm test
echo "✅ 全部校验通过"
