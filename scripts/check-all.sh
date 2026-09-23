#!/usr/bin/env bash
# 聚合校验入口：翻译对称性 + Agent 索引 + RLS 迁移 + 文档同步 + 无障碍 + 代码检查 + 测试
# 说明：check:bundle / check:perf 依赖构建产物，走 pnpm verify（含 build）覆盖，不在此重复触发构建
set -euo pipefail
cd "$(dirname "$0")/.."
# CI 只跑这一个入口，所以「哪道门禁红了」必须在日志里自己说出来：每步前打印 `==> <门禁>`，
# 出错时再补一条指明失败命令的收尾。缺了它，30 道门禁在 CI 里就是同一条红。
trap 'printf "\n❌ 门禁失败：%s\n" "$BASH_COMMAND" >&2' ERR
echo "==> check:locales"; pnpm --silent check:locales
echo "==> check:i18n";   pnpm --silent check:i18n
echo "==> check:action-errors"; pnpm --silent check:action-errors
echo "==> check:glossary"; pnpm --silent check:glossary
echo "==> check:dynamic-keys"; pnpm --silent check:dynamic-keys
echo "==> check:direction"; pnpm --silent check:direction
echo "==> check:agents"; pnpm --silent check:agents
echo "==> check:rls";    pnpm --silent check:rls
echo "==> check:migrations"; pnpm --silent check:migrations
echo "==> check:supabase-security"; pnpm --silent check:supabase-security
echo "==> check:query-columns"; pnpm --silent check:query-columns
echo "==> check:security"; pnpm --silent check:security
echo "==> check:release-docs"; pnpm --silent check:release-docs
echo "==> check:changelog";    pnpm --silent check:changelog
echo "==> check:gates";        pnpm --silent check:gates
echo "==> check:workflows";  pnpm --silent check:workflows
echo "==> check:production-smoke"; pnpm --silent check:production-smoke
echo "==> check:codeql";     pnpm --silent check:codeql
echo "==> check:secrets-scan"; pnpm --silent check:secrets-scan
echo "==> check:trace-coverage"; pnpm --silent check:trace-coverage
echo "==> check:cron-contract"; pnpm --silent check:cron-contract
echo "==> check:bilingual-docs"; pnpm --silent check:bilingual-docs
echo "==> check:release-tag"; pnpm --silent check:release-tag
echo "==> check:adr";         pnpm --silent check:adr
echo "==> check:mock-docs";      pnpm --silent check:mock-docs
echo "==> check:test-matrix";  pnpm --silent check:test-matrix
echo "==> check:migration-runbook"; pnpm --silent check:migration-runbook
echo "==> check:provider-docs";  pnpm --silent check:provider-docs
echo "==> check:tailwind";       pnpm --silent check:tailwind
echo "==> check:tokens";     pnpm --silent check:tokens
echo "==> check:fields";     pnpm --silent check:fields
echo "==> check:states";     pnpm --silent check:states
echo "==> check:docs";   pnpm --silent check:docs
echo "==> check:progress"; pnpm --silent check:progress
echo "==> check:a11y";   pnpm --silent check:a11y
echo "==> type-check";   pnpm --silent type-check
echo "==> lint";         pnpm --silent lint
echo "==> test";         pnpm test
echo "✅ 全部校验通过"
