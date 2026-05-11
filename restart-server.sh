#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ALL=false
BUILD=false
MODE="auto"

for arg in "$@"; do
  case "$arg" in
    --all)
      ALL=true
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
      echo "Usage: ./restart-server.sh [--all] [--build] [--mode=compose|process]"
      exit 1
      ;;
  esac
done

STOP_ARGS=()
START_ARGS=()

if [[ "$MODE" != "auto" ]]; then
  STOP_ARGS+=("--mode=$MODE")
  START_ARGS+=("--mode=$MODE")
fi

if [[ "$ALL" == "true" ]]; then
  STOP_ARGS+=(--all)
  START_ARGS+=(--all)
fi

if [[ "$BUILD" == "true" ]]; then
  START_ARGS+=(--build)
fi

"$SCRIPT_DIR/stop-server.sh" "${STOP_ARGS[@]}"
"$SCRIPT_DIR/start-server.sh" "${START_ARGS[@]}"
