#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# IndieStack - Project Setup Script
# =============================================================================
# Description: One-command setup for new developers joining the project.
# Usage:       bash scripts/setup.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check prerequisites
command -v node >/dev/null 2>&1 || error "Node.js is required. Install from https://nodejs.org"
command -v pnpm >/dev/null 2>&1 || error "pnpm is required. Install with: npm i -g pnpm"
command -v git  >/dev/null 2>&1 || error "git is required. Install from https://git-scm.com"

# Node version check
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js >= 18 is required. Current: $(node -v)"
fi

info "Node.js $(node -v) detected"
info "pnpm $(pnpm -v) detected"

# Check for Supabase CLI (optional)
if command -v supabase &> /dev/null; then
  info "Supabase CLI $(supabase --version) detected"
else
  warn "Supabase CLI not found. Install with: brew install supabase/tap/supabase"
fi

# Install dependencies
info "Installing dependencies with pnpm..."
pnpm install

# Setup environment
if [ ! -f .env.local ]; then
  info "Creating .env.local from .env.example..."
  cp .env.example .env.local
  warn "Please edit .env.local with your actual credentials"
else
  info ".env.local already exists, skipping..."
fi

info "Setup complete!"
info ""
info "Next steps:"
info "  1. Edit .env.local with your Supabase credentials"
info "  2. Run: pnpm dev"
info "  3. Open http://localhost:3000"
