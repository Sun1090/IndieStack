#!/bin/sh
# =============================================================================
# IndieStack - Git 钩子安装脚本
# =============================================================================
# Description: 把 .husky/ 里的钩子接到当前克隆的 hooks 目录。
# Usage:       sh scripts/install-hooks.sh   （由 package.json 的 prepare 在 pnpm install 后自动执行）
#
# 为什么不用 `git config core.hooksPath .husky`（husky 的做法）：
# hooksPath 会整体替换 `.git/hooks`，把用户或工具已经放在那里的钩子一起屏蔽掉
# ——本仓库的开发机上 `.git/hooks/post-commit` 与 `post-checkout` 就属于编辑器代理。
# 这里只按名字逐个软链自己那几个文件，别人的钩子原样保留。
# =============================================================================
set -eu

if [ "${INDIESTACK_SKIP_HOOKS:-0}" = "1" ]; then
  exit 0
fi

if ! repo_root=$(git rev-parse --show-toplevel 2>/dev/null); then
  # 不是 git 工作树：模板被 degit / 打包安装时属正常情况，静默跳过。
  exit 0
fi

hooks_dir=$(git rev-parse --git-path hooks)
if [ ! -d "$hooks_dir" ]; then
  echo "  · 跳过 Git 钩子安装：找不到 hooks 目录（$hooks_dir）"
  exit 0
fi

installed=0
skipped=0
for hook in "$repo_root/.husky/"*; do
  [ -f "$hook" ] || continue
  name=$(basename "$hook")
  case "$name" in
    _* | .*) continue ;;
  esac
  target="$hooks_dir/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    # 已存在非软链的同名钩子：那是用户自己的配置，不覆盖。
    skipped=$((skipped + 1))
    continue
  fi
  if [ -L "$target" ] && [ "$(readlink "$target")" = "$hook" ]; then
    continue # 已经装好
  fi
  ln -sf "$hook" "$target"
  installed=$((installed + 1))
done

if [ "$installed" -gt 0 ]; then
  echo "  ✓ 已接入 $installed 个 Git 钩子（.husky → $hooks_dir）"
fi
if [ "$skipped" -gt 0 ]; then
  echo "  · 保留 $skipped 个同名自定义钩子（未覆盖）"
fi
