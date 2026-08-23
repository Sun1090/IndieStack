#!/usr/bin/env bash
# =============================================================================
# Supabase 数据库备份脚本
# 用法:
#   bash scripts/backup-db.sh              # 输出到 ./backups/
#   BACKUP_DIR=/path bash scripts/backup-db.sh
#
# 依赖: supabase CLI（已链接项目）或 psql + DATABASE_URL
# 建议配合 cron 每日执行，并异地保存（对象存储/云盘）
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

echo "==> 开始备份数据库..."

# 方式一：supabase CLI dump（含 schema + data + RLS 策略）
if command -v supabase >/dev/null 2>&1 && [ -f supabase/config.toml ]; then
  OUT="$BACKUP_DIR/supabase-$STAMP.sql"
  supabase db dump --file "$OUT"
  echo "==> 已备份到 $OUT ($(du -h "$OUT" | cut -f1))"
else
  # 方式二：pg_dump 直连（需 SUPABASE_DB_URL）
  : "${SUPABASE_DB_URL:?需要设置 SUPABASE_DB_URL 环境变量}"
  OUT="$BACKUP_DIR/db-$STAMP.dump"
  pg_dump "$SUPABASE_DB_URL" -Fc -f "$OUT"
  echo "==> 已备份到 $OUT ($(du -h "$OUT" | cut -f1))"
fi

# 清理 30 天前的旧备份
find "$BACKUP_DIR" -name "*.sql" -o -name "*.dump" | while read -r f; do
  if [ "$(find "$f" -mtime +30)" ]; then
    rm "$f" && echo "==> 已清理过期备份: $f"
  fi
done

echo "==> 备份完成。请将备份文件同步到异地存储！"
