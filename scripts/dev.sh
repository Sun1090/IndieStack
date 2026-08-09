#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# IndieStack — Development Helper Script
# =============================================================================
# Usage: bash scripts/dev.sh [command]
#
# Commands:
#   start       Start dev server with env checks
#   db:up       Start PostgreSQL (Docker)
#   db:down     Stop PostgreSQL
#   db:seed     Run seed data
#   db:types    Generate Supabase TypeScript types
#   lint        Run linter
#   type-check  Run TypeScript check
#   build       Production build
#   help        Show this help
# =============================================================================

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}==>${NC} ${BOLD}$1${NC}"; }
warn()  { echo -e "${YELLOW}==>${NC} ${BOLD}$1${NC}"; }
error() { echo -e "${RED}==>${NC} ${BOLD}$1${NC}"; }

check_env() {
  if [ ! -f .env.local ]; then
    warn ".env.local not found. Copying from .env.example..."
    cp .env.example .env.local
    info "Edit .env.local with your credentials before starting."
  fi
}

case "${1:-help}" in
  start)
    check_env
    info "Starting development server..."
    pnpm dev
    ;;
  db:up)
    info "Starting PostgreSQL..."
    docker compose up -d postgres
    info "PostgreSQL is running on port 5432"
    ;;
  db:down)
    info "Stopping PostgreSQL..."
    docker compose down
    ;;
  db:seed)
    info "Seeding database..."
    if command -v psql &> /dev/null; then
      PGPASSWORD=postgres psql -h localhost -U postgres -d indiestack -f supabase/seed.sql
    else
      warn "psql not found. Use: npx supabase db seed"
    fi
    ;;
  db:types)
    info "Generating TypeScript types from database..."
    pnpm db:types
    ;;
  lint)
    info "Running linter..."
    pnpm lint
    ;;
  type-check)
    info "Running TypeScript check..."
    pnpm type-check
    ;;
  build)
    info "Running production build..."
    pnpm build
    ;;
  help|*)
    echo "IndieStack Development Helper"
    echo ""
    echo "Usage: bash scripts/dev.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start dev server with env checks"
    echo "  db:up       Start PostgreSQL (Docker)"
    echo "  db:down     Stop PostgreSQL"
    echo "  db:seed     Run seed data"
    echo "  db:types    Generate Supabase TypeScript types"
    echo "  lint        Run linter"
    echo "  type-check  Run TypeScript check"
    echo "  build       Production build"
    echo "  help        Show this help"
    ;;
esac
