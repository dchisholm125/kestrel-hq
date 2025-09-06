#!/usr/bin/env bash
set -euo pipefail

# Load environment variables from .env file if it exists
if [ -f "src/.env" ]; then
  set -a
  source src/.env
  set +a
fi

echo "[dev] Starting protocol server (auto-reload via tsx)" >&2
exec npx tsx watch src/main.ts
