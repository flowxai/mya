#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[mya] installing core dependencies..."
bun install --frozen-lockfile 2>/dev/null || bun install

echo "[mya] installing bundled channel runtime dependencies..."
npm --prefix "$ROOT_DIR/runtime/connect" install

echo "[mya] bootstrap complete"
