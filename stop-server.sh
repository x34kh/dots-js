#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="docker-compose.yml"
DEFAULT_SERVICES=(backend redis)
ALL_SERVICES=(frontend backend redis)
PID_FILE=".backend-server.pid"
MODE="auto"
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
  local pid raw

  if [[ -f "$PID_FILE" ]]; then
    pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if is_backend_pid "$pid"; then
      out+=("$pid")
    fi
  fi

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

terminate_pid() {
  local pid="$1"
  local i

  kill "$pid" 2>/dev/null || true

  for i in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  echo "Process $pid did not stop gracefully, forcing kill"
  kill -9 "$pid" 2>/dev/null || true

  for i in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done

  return 1
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

stop_process_backend() {
  local stopped=false
  local failed=false
  local pids pid

  pids=$(collect_backend_pids)
  if [[ -n "$pids" ]]; then
    echo "Stopping detected backend node process(es): $pids"
    while IFS= read -r pid; do
      [[ -n "$pid" ]] || continue
      if terminate_pid "$pid"; then
        stopped=true
      else
        failed=true
      fi
    done <<< "$pids"
  fi

  rm -f "$PID_FILE"

  if [[ "$stopped" == "false" ]]; then
    echo "No backend process found"
  fi

  if [[ "$failed" == "true" ]]; then
    echo "Error: failed to stop one or more backend processes"
    exit 1
  fi
}

for arg in "$@"; do
  case "$arg" in
    --all)
      INCLUDE_ALL=true
      ;;
    --mode=compose)
      MODE="compose"
      ;;
    --mode=process)
      MODE="process"
      ;;
    *)
      echo "Error: unknown option '$arg'"
      echo "Usage: ./stop-server.sh [--all] [--mode=compose|process]"
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

  echo "Stopping services with compose: ${SERVICES[*]}"
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" stop "${SERVICES[@]}"
  "${COMPOSE_CMD[@]}" -f "$COMPOSE_FILE" ps
  exit 0
fi

stop_process_backend
