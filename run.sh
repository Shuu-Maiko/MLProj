#!/usr/bin/env bash
set -euo pipefail

# Starts the forecast service and the game together, and stops both together.
#
#   ./run.sh                 run backend + frontend
#   ./run.sh --assets        rebuild the sprite atlases first
#   API_PORT=8050 ./run.sh    move the backend (the game reads FORECAST_API)
#
# Logs land in .run/, PIDs in .run/pids. Ctrl-C shuts both down.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
GAME="$ROOT/game"
LOG_DIR="${LOG_DIR:-$ROOT/.run}"
API_HOST="${API_HOST:-127.0.0.1}"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"

mkdir -p "$LOG_DIR"

say()  { printf '\033[36m·\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_for() { # wait_for <url> <seconds> <name>
  local url="$1" limit="$2" name="$3" i=0
  until curl -sf --max-time 2 "$url" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt "$((limit * 2))" ] && return 1
    sleep 0.5
  done
  say "$name is up"
}

# --- preflight ---------------------------------------------------------------
[ -x "$BACKEND/.venv/bin/python" ] || die "no backend venv at $BACKEND/.venv
  create it with:  cd backend && uv venv --python 3.12 .venv
  then install:    uv pip install -r requirements.txt"
[ -d "$GAME/node_modules" ] || die "no node_modules in $GAME — run: cd game && npm install"
[ -f "$BACKEND/data/processed/panel.parquet" ] || die "missing $BACKEND/data/processed/panel.parquet — the data pipeline has not been run"

API_PID=""
WEB_PID=""

cleanup() {
  trap - EXIT INT TERM
  for pid in "$API_PID" "$WEB_PID"; do
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && { say "stopping $pid"; kill "$pid" 2>/dev/null || true; }
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- sprite atlases ----------------------------------------------------------
if [ "${1:-}" = "--assets" ]; then
  say "rebuilding sprite atlases"
  (cd "$ROOT/tools" && node build.js)
fi

# --- backend -----------------------------------------------------------------
if curl -sf --max-time 2 "http://$API_HOST:$API_PORT/health" >/dev/null 2>&1; then
  say "reusing the forecast service already on $API_HOST:$API_PORT"
elif port_open "$API_PORT"; then
  die "port $API_PORT is taken by something that is not the forecast service"
else
  say "starting forecast service on $API_HOST:$API_PORT"
  ( cd "$BACKEND" && exec .venv/bin/python -W ignore src/api/main.py ) \
    >"$LOG_DIR/backend.log" 2>&1 &
  API_PID=$!
  # Loading the checkpoint and the 23k-row panel is not instant.
  wait_for "http://$API_HOST:$API_PORT/health" 60 "forecast service" \
    || die "forecast service did not answer /health — see $LOG_DIR/backend.log"
fi

# --- frontend ----------------------------------------------------------------
if port_open "$WEB_PORT"; then
  die "port $WEB_PORT is already in use — stop the other server or set WEB_PORT"
fi
say "starting the game on http://localhost:$WEB_PORT"
( cd "$GAME" && exec npm run dev -- --port "$WEB_PORT" ) >"$LOG_DIR/frontend.log" 2>&1 &
WEB_PID=$!

# Next blocks cross-origin dev resources, so 127.0.0.1 will not load the client
# bundle even though the server answers. Always hand out the localhost URL.
wait_for "http://localhost:$WEB_PORT/" 90 "game" \
  || die "the game did not respond — see $LOG_DIR/frontend.log"

say "open http://localhost:$WEB_PORT"
say "logs: $LOG_DIR/backend.log  $LOG_DIR/frontend.log"

# Return as soon as either service dies. Waiting on both would hang with a dead page
# still open in the browser.
wait -n || true
if ! kill -0 "$API_PID" 2>/dev/null; then
  warn "the forecast service exited — tail $LOG_DIR/backend.log"
elif ! kill -0 "$WEB_PID" 2>/dev/null; then
  warn "the game exited — tail $LOG_DIR/frontend.log"
fi
