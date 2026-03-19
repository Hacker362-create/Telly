#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# start.sh — One-shot local development launcher for Telly VoIP
#
# Usage:
#   chmod +x start.sh
#   ./start.sh
#
# Then open http://localhost:3000 in your browser.
# ─────────────────────────────────────────────────────────────────
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║        📡  Telly VoIP  📡             ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# ── 1. .env ────────────────────────────────────────────────────
if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "▶ Creating .env from .env.example ..."
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "  ✓ .env created (SQLite – no database server needed)"
else
  echo "  ✓ .env already exists"
fi

# ── 2. npm install ─────────────────────────────────────────────
echo ""
echo "▶ Installing dependencies ..."
(cd "$BACKEND_DIR" && npm install --silent)
echo "  ✓ node_modules ready"

# ── 3. Database ────────────────────────────────────────────────
echo ""
echo "▶ Setting up database (SQLite) ..."
(cd "$BACKEND_DIR" && npm run db:setup 2>/dev/null || npm run db:push)
echo "  ✓ Database ready"

# ── 4. Start server ────────────────────────────────────────────
echo ""
echo "▶ Starting Telly backend ..."
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  Open your browser:                     │"
echo "  │  ➜  http://localhost:3000               │"
echo "  └─────────────────────────────────────────┘"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

cd "$BACKEND_DIR" && npm run dev
