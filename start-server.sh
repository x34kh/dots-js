#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
DEFAULT_SERVICES=(redis backend)
ALL_SERVICES=(redis backend frontend)
PID_FILE=".backend-server.pid"
BACKEND_LOG="backend/server.log"
MODE="auto"
BUILD=false
INCLUDE_ALL=false
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

is_backend_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1

  local cwd cmdline
  cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
  cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)

  [[ "$cwd" == "$BACKEND_DIR" ]] || return 1
  [[ "$cmdline" == *"node"* ]] || return 1
  [[ "$cmdline" == *"src/index.js"* ]] || return 1

  return 0
}

collect_backend_pids() {
  local out=()
  local raw pid

  raw=$(pgrep -f "node .*src/index.js" || true)
  if [[ -n "$raw" ]]; then
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      if is_backend_pid "$pid"; then
        out+=("$pid")
      fi
    done <<< "$raw"
  fi

  if [[ ${#out[@]} -gt 0 ]]; then
    printf '%s\n' "${out[@]}" | awk '!seen[$0]++'
  fi
}

compose_available() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
    return 0
  fi
  return 1
}

compose_backend_exists() {
  [[ -f "$COMPOSE_FILE" ]] || return 1
  compose_available || return 1
  local status
  status=$("${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps backend --status running --quiet 2>/dev/null || true)
  [[ -n "$status" ]]
}

process_backend_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if is_backend_pid "$pid"; then
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  local pids
  pids=$(collect_backend_pids)
  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | head -n1 > "$PID_FILE"
    return 0
  fi

  return 1
}

for arg in "$@"; do
  case "$arg" in
    --all)
      INCLUDE_ALL=true
      ;;
    --build)
      BUILD=true
      ;;
    --mode=compose)
      MODE="compose"
      ;;
    --mode=process)
      MODE="process"
      ;;
    *)
      echo "Error: unknown option '$arg'"
      echo "Usage: ./start-server.sh [--all] [--build] [--mode=compose|process]"
      exit 1
      ;;
  esac
done

if [[ "$MODE" == "auto" ]]; then
  if compose_backend_exists; then
    MODE="compose"
  else
    MODE="process"
  fi
fi

if [[ "$MODE" == "compose" ]]; then
  [[ -f "$COMPOSE_FILE" ]] || { echo "Error: $COMPOSE_FILE not found"; exit 1; }
  compose_available || { echo "Error: docker compose is required for compose mode"; exit 1; }

  SERVICES=("${DEFAULT_SERVICES[@]}")
  if [[ "$INCLUDE_ALL" == "true" ]]; then
    SERVICES=("${ALL_SERVICES[@]}")
  fi

  echo "Starting services with compose: ${SERVICES[*]}"
  UP_ARGS=(up -d)
  if [[ "$BUILD" == "true" ]]; then
    UP_ARGS+=(--build)
  fi
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" "${UP_ARGS[@]}" "${SERVICES[@]}"
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps
  exit 0
fi

if process_backend_running; then
  echo "Backend process is already running"
  exit 0
fi

if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "Error: backend directory not found"
  exit 1
fi

echo "Starting backend process with npm start"
nohup npm --prefix backend run start > "$BACKEND_LOG" 2>&1 &
echo $! > "$PID_FILE"
echo "Backend started (pid: $(cat "$PID_FILE"))"
