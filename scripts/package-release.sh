#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
OUTPUT_DIR="${2:-$ROOT_DIR/release}"

if [[ -z "$TARGET" ]]; then
  echo "usage: ./scripts/package-release.sh <target> [output-dir]" >&2
  echo "example: ./scripts/package-release.sh macos-arm64" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/install.sh" ]]; then
  echo "[package-release] missing install.sh at $ROOT_DIR/install.sh" >&2
  exit 1
fi

CLI_SOURCE="$ROOT_DIR/dist/cli"
if [[ ! -f "$CLI_SOURCE" ]]; then
  echo "[package-release] missing compiled CLI at $CLI_SOURCE" >&2
  echo "[package-release] run 'bun run compile' first" >&2
  exit 1
fi

CONNECT_DIR="$ROOT_DIR/connect"
CONNECT_NODE_MODULES="$CONNECT_DIR/node_modules"
if [[ ! -d "$CONNECT_NODE_MODULES" ]]; then
  echo "[package-release] missing bundled connect dependencies at $CONNECT_NODE_MODULES" >&2
  echo "[package-release] run 'npm --prefix ./connect ci --omit=dev' first" >&2
  exit 1
fi

VERSION="$(
  node -p "require(process.argv[1]).version" "$ROOT_DIR/package.json"
)"

ARCHIVE_BASENAME="mya-${VERSION}-${TARGET}"
STAGE_DIR="$OUTPUT_DIR/stage/$ARCHIVE_BASENAME"
PACKAGE_DIR="$STAGE_DIR/mya"
ARCHIVE_PATH="$OUTPUT_DIR/${ARCHIVE_BASENAME}.tar.gz"

rm -rf "$STAGE_DIR"
mkdir -p "$PACKAGE_DIR" "$PACKAGE_DIR/bin" "$PACKAGE_DIR/connect"

cp "$CLI_SOURCE" "$PACKAGE_DIR/cli"
chmod 755 "$PACKAGE_DIR/cli"
cp "$ROOT_DIR/bin/mya" "$PACKAGE_DIR/bin/mya"
chmod 755 "$PACKAGE_DIR/bin/mya"
cp "$ROOT_DIR/install.sh" "$PACKAGE_DIR/install.sh"
chmod 755 "$PACKAGE_DIR/install.sh"
cp "$ROOT_DIR/README.md" "$PACKAGE_DIR/README.md"

cp "$CONNECT_DIR/package.json" "$PACKAGE_DIR/connect/package.json"
cp "$CONNECT_DIR/package-lock.json" "$PACKAGE_DIR/connect/package-lock.json"
cp "$CONNECT_DIR/README.md" "$PACKAGE_DIR/connect/README.md"
cp "$CONNECT_DIR/Usage.md" "$PACKAGE_DIR/connect/Usage.md"
cp -R "$CONNECT_DIR/bin" "$PACKAGE_DIR/connect/bin"
cp -R "$CONNECT_DIR/src" "$PACKAGE_DIR/connect/src"
cp -R "$CONNECT_NODE_MODULES" "$PACKAGE_DIR/connect/node_modules"

tar -C "$STAGE_DIR" -czf "$ARCHIVE_PATH" mya

echo "$ARCHIVE_PATH"
