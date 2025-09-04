#!/usr/bin/env bash
set -euo pipefail

# Simple dev bootstrap for Kestrel Protocol
# 1. Start anvil fork (background)
# 2. Start protocol server with restart on changes

# Prefer explicit MAINNET_RPC_URL env var, otherwise try to read RPC_URL or MAINNET_RPC_URL from src/.env
if [ -z "${MAINNET_RPC_URL:-}" ]; then
  if [ -f "src/.env" ]; then
    # Try RPC_URL first, then MAINNET_RPC_URL
    RPC_FROM_FILE=$(grep -E '^\s*RPC_URL\s*=' src/.env | head -n1 | cut -d'=' -f2- | sed -E "s/^['\"]?(.*)['\"]?$/\1/") || true
    if [ -n "$RPC_FROM_FILE" ]; then
      MAINNET_RPC_URL="$RPC_FROM_FILE"
      echo "[dev] MAINNET_RPC_URL loaded from src/.env (RPC_URL)" >&2
    else
      RPC_FROM_FILE=$(grep -E '^\s*MAINNET_RPC_URL\s*=' src/.env | head -n1 | cut -d'=' -f2- | sed -E "s/^['\"]?(.*)['\"]?$/\1/") || true
      if [ -n "$RPC_FROM_FILE" ]; then
        MAINNET_RPC_URL="$RPC_FROM_FILE"
        echo "[dev] MAINNET_RPC_URL loaded from src/.env (MAINNET_RPC_URL)" >&2
      fi
    fi
  fi
fi

if [ -z "${MAINNET_RPC_URL:-}" ]; then
  echo "MAINNET_RPC_URL not set and no RPC_URL found in src/.env; please set MAINNET_RPC_URL or add RPC_URL to src/.env" >&2
  exit 1
fi

ANVIL_PORT=${ANVIL_PORT:-8545}
ANVIL_HOST=${ANVIL_HOST:-127.0.0.1}
FORK_BLOCK_OPT=${FORK_BLOCK:+--fork-block-number $FORK_BLOCK}

echo "[dev] Starting anvil fork on ${ANVIL_HOST}:${ANVIL_PORT} (fork: $MAINNET_RPC_URL $FORK_BLOCK_OPT)" >&2
anvil --host $ANVIL_HOST --port $ANVIL_PORT --fork-url "$MAINNET_RPC_URL" $FORK_BLOCK_OPT --chain-id 1 &
ANVIL_PID=$!

# Wait for anvil to respond; if fork fails (bad RPC URL) fall back to a local anvil without forking
WAIT_SECS=1
TRIES=0
MAX_TRIES=6
while ! curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://${ANVIL_HOST}:${ANVIL_PORT} >/dev/null 2>&1; do
  TRIES=$((TRIES+1))
  if [ $TRIES -ge $MAX_TRIES ]; then
    echo "[dev] Forked anvil did not respond after $((WAIT_SECS*MAX_TRIES))s; falling back to non-forked anvil" >&2
    # kill previous anvil if still running
    if kill -0 "$ANVIL_PID" 2>/dev/null; then
      kill "$ANVIL_PID" || true
      wait "$ANVIL_PID" 2>/dev/null || true
    fi
    # start anvil without fork
    anvil --host $ANVIL_HOST --port $ANVIL_PORT --chain-id 1 &
    ANVIL_PID=$!
    break
  fi
  sleep $WAIT_SECS
done

cleanup() {
  echo "[dev] Shutting down (anvil pid $ANVIL_PID)" >&2
  if kill -0 "$ANVIL_PID" 2>/dev/null; then
    kill "$ANVIL_PID" || true
  fi
}
trap cleanup EXIT INT TERM

# Wait briefly for anvil readiness
sleep 2

if ! curl -s -X POST --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' http://${ANVIL_HOST}:${ANVIL_PORT} >/dev/null; then
  echo "[dev] WARNING: anvil not responding yet; continuing anyway" >&2
fi

echo "[dev] Starting protocol server (auto-reload via tsx)" >&2
exec npx tsx watch src/main.ts
