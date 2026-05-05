#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# start.sh — One-shot local development launcher for Telly VoIP
#
# Usage:
#   ./start.sh
#
# The script starts the server and then automatically opens
# http://localhost:3000 in your default browser.
# ─────────────────────────────────────────────────────────────────

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
PORT="${PORT:-3000}"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║        📡  Telly VoIP  📡             ║"
echo "╚═══════════════════════════════════════╝"
echo ""
echo "  Your app will be at → http://localhost:${PORT}"
echo ""

# ── Guard: Node.js required ────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed."
  echo "  → Download it from https://nodejs.org (LTS version recommended)"
  exit 1
fi
echo "  ✓ Node.js $(node --version) found"

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
echo "▶ Installing dependencies (this may take a minute on first run) ..."
if ! (cd "$BACKEND_DIR" && npm install --silent); then
  echo ""
  echo "✗ npm install failed."
  echo "  → Make sure you have internet access, then try again."
  exit 1
fi
echo "  ✓ node_modules ready"

# ── 3. Database ────────────────────────────────────────────────
echo ""
echo "▶ Setting up database (SQLite) ..."
if ! (cd "$BACKEND_DIR" && npm run db:setup 2>/dev/null || npm run db:push 2>/dev/null); then
  echo "  ⚠ Database setup had warnings (the server may still work)"
else
  echo "  ✓ Database ready"
fi

# ── 4. Check for port conflict ─────────────────────────────────
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo ""
  echo "✗ Port $PORT is already in use."
  echo "  → Stop the process using port $PORT, or run:"
  echo "    PORT=$((PORT + 1)) ./start.sh"
  exit 1
fi

# ── 5. Start server ────────────────────────────────────────────
echo ""
echo "▶ Starting Telly backend ..."
echo ""
echo "  ╔═════════════════════════════════════════╗"
echo "  ║  🌐  http://localhost:${PORT}               ║"
echo "  ║  Open that URL in your browser          ║"
echo "  ╚═════════════════════════════════════════╝"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

# Try to open the browser once the server is ready (background poll)
(
  for i in $(seq 1 30); do
    sleep 1
    if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
      URL="http://localhost:${PORT}"
      # macOS
      if command -v open >/dev/null 2>&1; then open "$URL"
      # Linux (XDG / GNOME / KDE)
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
      fi
      break
    fi
  done
) &

cd "$BACKEND_DIR" && PORT="$PORT" npm start
