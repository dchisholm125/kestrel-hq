#!/bin/bash
# Starts an anvil instance with a mainnet fork using the RPC_URL from the environment
# It will prefer the RPC_URL environment variable, then fall back to parsing src/.env or .env

set -euo pipefail

get_rpc_from_envfile() {
  local f="$1"
  if [ ! -f "$f" ]; then
    return 1
  fi
  # Look for a line starting with RPC_URL= or export RPC_URL=
  local line
  line=$(grep -m1 -E '^(export[[:space:]]+)?RPC_URL=' "$f" || true)
  if [ -z "$line" ]; then
    return 1
  fi
  # Remove export, leading key, and surrounding quotes
  echo "$line" | sed -E 's/^[[:space:]]*(export[[:space:]]+)?RPC_URL[[:space:]]*=[[:space:]]*//i' | sed -E 's/^\"|\"$|^\'\''|\'\''$//g'
}

# 1) Prefer environment variable
: "${RPC_URL:=}"

if [ -z "${RPC_URL:-}" ]; then
  # 2) Try src/.env
  RPC_URL=$(get_rpc_from_envfile "src/.env" || true)
fi

if [ -z "${RPC_URL:-}" ]; then
  # 3) Try project root .env
  RPC_URL=$(get_rpc_from_envfile ".env" || true)
fi

if [ -z "${RPC_URL:-}" ]; then
  echo "Error: RPC_URL not set. Please set the RPC_URL environment variable or add it to src/.env or .env"
  exit 1
fi

usage() {
  echo "usage: $0 [RPC_URL]"
  echo "You can also set RPC_URL or RPC_FALLBACKS in the environment."
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ -n "${1:-}" ]; then
  RPC_URL="$1"
fi

# Do not allow websocket urls for anvil forking
if echo "$RPC_URL" | grep -qiE '^wss?://'; then
  echo "Error: websocket URLs (ws:// or wss://) are not supported for anvil --fork-url."
  echo "Use an HTTP(S) JSON-RPC endpoint for forking. You can still use websocket endpoints in your app's provider."
  exit 1
fi

rpc_health() {
  local url="$1"
  # simple eth_blockNumber probe
  local resp
  resp=$(curl -s -X POST -H 'Content-Type: application/json' --max-time 5 --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' "$url" || true)
  if [ -z "$resp" ]; then
    return 1
  fi
  # detect rate limit or error
  if echo "$resp" | grep -qi 'Too Many Requests\|429\|rate limit'; then
    return 2
  fi
  if echo "$resp" | grep -q 'result"' ; then
    return 0
  fi
  return 1
}

# If RPC_FALLBACKS env variable provided, use as comma-separated list
IFS=',' read -r -a FALLBACKS <<< "${RPC_FALLBACKS:-}"

try_list=( )
if [ -n "${RPC_URL:-}" ]; then
  try_list+=("$RPC_URL")
fi
for f in "${FALLBACKS[@]}"; do
  if [ -n "$f" ]; then
    try_list+=("$f")
  fi
done

# default public fallbacks if none provided
if [ ${#try_list[@]} -eq 0 ]; then
  try_list=("https://eth.llamarpc.com" "https://rpc.ankr.com/eth" "https://cloudflare-eth.com")
fi

selected=""
for url in "${try_list[@]}"; do
  echo "Probing $url"
  rpc_health "$url"
  rc=$?
  if [ $rc -eq 0 ]; then
    selected="$url"
    break
  elif [ $rc -eq 2 ]; then
    echo "  -> rate limited: $url"
    continue
  else
    echo "  -> no response from $url"
    continue
  fi
done

if [ -z "$selected" ]; then
  echo "No healthy RPC found among candidates. Set RPC_URL to a working HTTP(S) provider (Alchemy/QuickNode) or run a local node."
  exit 1
fi

echo "Starting anvil fork with RPC_URL=$selected"
exec anvil --fork-url "$selected"
