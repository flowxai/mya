#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

REPO_SLUG="${MYA_REPO_SLUG:-flowxai/mya}"
REPO_URL="${MYA_REPO_URL:-https://github.com/${REPO_SLUG}.git}"
INSTALL_DIR="${MYA_INSTALL_DIR:-$HOME/mya}"
LINK_DIR="${MYA_LINK_DIR:-$HOME/.local/bin}"
CONNECT_CONFIG_DIR="${MYA_CONNECT_CONFIG_DIR:-${MYA_CONFIG_DIR:-$HOME/.mya/connect}}"
TARGET_VERSION="latest"
INSTALL_MODE="auto"
UPGRADE_ONLY=0
CONNECT_READY=0
CONNECT_SUPPORTED=0
BUN_MIN_VERSION="1.3.11"
NODE_MIN_MAJOR="22"
SCRIPT_SOURCE_DIR=""
OS=""
ARCH=""
RELEASE_TAG=""

info()  { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[x]${RESET} %s\n" "$*"; exit 1; }

connect_install_dir() {
  local base_dir="$1"

  if [[ -f "$base_dir/runtime/connect/package.json" ]]; then
    printf '%s\n' "$base_dir/runtime/connect"
    return
  fi

  printf '%s\n' "$base_dir/runtime/connect"
}

header() {
  echo ""
  printf "${BOLD}${CYAN}"
  cat <<'ART'
  __  __ _   _  __ _
 |  \/  | | | |/ _` |
 | |\/| | |_| | (_| |
 |_|  |_|\__, |\__,_|
          |___/
ART
  printf "${RESET}"
  printf "${DIM}  mya CLI with bundled channel connectors${RESET}\n"
  echo ""
}

usage() {
  cat <<EOF
Usage: ./install.sh [options]

Options:
  --source              Install from source checkout or clone the repo and build
  --release             Install a prebuilt GitHub release archive
  --version <tag>       Release tag to install (default: latest)
  --dir <path>          Installation directory (default: \$HOME/mya)
  --upgrade             Upgrade an existing installation in place
  -h, --help            Show this help

Environment overrides:
  MYA_REPO_SLUG         GitHub repo slug used for releases (default: flowxai/mya)
  MYA_REPO_URL          Git clone URL for source installs
  MYA_INSTALL_DIR       Install destination (default: \$HOME/mya)
  MYA_LINK_DIR          Directory for the mya symlink (default: \$HOME/.local/bin)
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source)
        INSTALL_MODE="source"
        shift
        ;;
      --release)
        INSTALL_MODE="release"
        shift
        ;;
      --version)
        [[ $# -ge 2 ]] || fail "--version requires a value"
        TARGET_VERSION="$2"
        shift 2
        ;;
      --dir)
        [[ $# -ge 2 ]] || fail "--dir requires a value"
        INSTALL_DIR="$2"
        shift 2
        ;;
      --upgrade)
        UPGRADE_ONLY=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
  done
}

check_prerequisites() {
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  command -v tar >/dev/null 2>&1 || fail "tar is required"
}

detect_source_dir() {
  local script_path=""
  script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${script_path}/package.json" && -f "${script_path}/scripts/build.ts" ]]; then
    SCRIPT_SOURCE_DIR="$script_path"
  fi
}

detect_mode() {
  if [[ "$INSTALL_MODE" != "auto" ]]; then
    return
  fi

  if [[ -n "$SCRIPT_SOURCE_DIR" ]]; then
    INSTALL_MODE="source"
  else
    INSTALL_MODE="release"
  fi
}

check_os() {
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux) OS="linux" ;;
    *) fail "Unsupported OS: $(uname -s). macOS or Linux required." ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac

  ok "Platform: $(uname -s) $(uname -m)"
}

version_gte() {
  [[ "$(printf '%s\n' "$1" "$2" | sort -V | head -1)" == "$2" ]]
}

check_bun() {
  if command -v bun >/dev/null 2>&1; then
    local ver
    ver="$(bun --version 2>/dev/null || echo "0.0.0")"
    if version_gte "$ver" "$BUN_MIN_VERSION"; then
      ok "bun: v${ver}"
      return
    fi
    warn "bun v${ver} found but v${BUN_MIN_VERSION}+ required. Upgrading..."
  else
    info "bun not found. Installing..."
  fi
  install_bun
}

install_bun() {
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || fail "bun installed but not found on PATH. Add \$HOME/.bun/bin to PATH and retry."
  ok "bun: v$(bun --version) (just installed)"
}

check_git() {
  command -v git >/dev/null 2>&1 || fail "git is required for source installs"
  ok "git: $(git --version | head -1)"
}

check_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "Node.js + npm not found. Base mya will work, but wechat / feishu / bot service will stay disabled."
    return
  fi

  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$major" -lt "$NODE_MIN_MAJOR" ]]; then
    warn "Node.js $(node --version) found, but v${NODE_MIN_MAJOR}+ is required for mya wechat / mya feishu / mya serve."
    return
  fi

  CONNECT_READY=1
  CONNECT_SUPPORTED=1
  ok "node: $(node --version)"
  ok "npm:  $(npm --version)"
}

ensure_parent_dir() {
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mkdir -p "$LINK_DIR"
  mkdir -p "$CONNECT_CONFIG_DIR"
}

seed_hub_templates() {
  local connect_dir source_env_example source_examples_dir target_env_example target_examples_dir

  connect_dir="$(connect_install_dir "$INSTALL_DIR")"

  source_env_example="$connect_dir/.env.hub.example"
  source_examples_dir="$connect_dir/examples/profiles"
  target_env_example="$CONNECT_CONFIG_DIR/.env.hub.example"
  target_examples_dir="$CONNECT_CONFIG_DIR/examples/profiles"

  mkdir -p "$target_examples_dir"

  if [[ -f "$source_env_example" && ! -f "$target_env_example" ]]; then
    cp "$source_env_example" "$target_env_example"
    ok "Installed hub env template: $target_env_example"
  fi

  if [[ -d "$source_examples_dir" ]]; then
    local copied_count=0
    local profile_file target_file
    while IFS= read -r -d '' profile_file; do
      target_file="$target_examples_dir/$(basename "$profile_file")"
      if [[ ! -f "$target_file" ]]; then
        cp "$profile_file" "$target_file"
        copied_count=$((copied_count + 1))
      fi
    done < <(find "$source_examples_dir" -type f -name '*.json' -print0)

    if [[ "$copied_count" -gt 0 ]]; then
      ok "Installed hub profile templates: $target_examples_dir"
    fi
  fi
}

clone_or_refresh_repo() {
  if [[ -n "$SCRIPT_SOURCE_DIR" ]]; then
    info "Installing from local checkout: $SCRIPT_SOURCE_DIR"
    rm -rf "$INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    cp -R "$SCRIPT_SOURCE_DIR" "$INSTALL_DIR"
    ok "Copied source checkout to $INSTALL_DIR"
    return
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Refreshing existing source checkout..."
    git -C "$INSTALL_DIR" fetch --tags --prune origin
    if [[ "$TARGET_VERSION" == "latest" ]]; then
      git -C "$INSTALL_DIR" checkout --force main
      git -C "$INSTALL_DIR" pull --ff-only origin main
    else
      git -C "$INSTALL_DIR" checkout --force "$TARGET_VERSION"
    fi
    ok "Updated source checkout at $INSTALL_DIR"
    return
  fi

  info "Cloning repository..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  if [[ "$TARGET_VERSION" != "latest" ]]; then
    git -C "$INSTALL_DIR" fetch --tags --depth 1 origin "$TARGET_VERSION"
    git -C "$INSTALL_DIR" checkout --force "$TARGET_VERSION"
  fi
  ok "Cloned source to $INSTALL_DIR"
}

install_core_from_source() {
  local connect_dir

  check_git
  check_bun
  clone_or_refresh_repo

  info "Installing core dependencies..."
  (cd "$INSTALL_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install)
  ok "Core dependencies installed"

  connect_dir="$(connect_install_dir "$INSTALL_DIR")"

  if [[ "$CONNECT_SUPPORTED" -eq 1 && -f "$connect_dir/package.json" ]]; then
    info "Installing bundled connector dependencies..."
    npm --prefix "$connect_dir" install
    ok "Bundled connector dependencies installed"
  else
    warn "Skipping bundled connector dependencies."
    CONNECT_READY=0
  fi

  info "Building mya..."
  (cd "$INSTALL_DIR" && bun run build)
  ok "Binary built: $INSTALL_DIR/cli"
}

resolve_latest_release_tag() {
  local latest_url effective_url
  latest_url="https://github.com/${REPO_SLUG}/releases/latest"
  effective_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "$latest_url")"
  RELEASE_TAG="${effective_url##*/}"
  [[ -n "$RELEASE_TAG" ]] || fail "Failed to resolve the latest GitHub release tag"
}

resolve_release_tag() {
  if [[ "$TARGET_VERSION" == "latest" ]]; then
    resolve_latest_release_tag
  else
    RELEASE_TAG="$TARGET_VERSION"
  fi
}

extract_release_archive() {
  local tmp_root archive_url archive_path unpack_dir extracted_dir archive_basename
  tmp_root="$(mktemp -d)"
  archive_basename="mya-${RELEASE_TAG#v}-${OS}-${ARCH}.tar.gz"
  archive_path="$tmp_root/${archive_basename}"
  unpack_dir="$tmp_root/unpack"
  archive_url="https://github.com/${REPO_SLUG}/releases/download/${RELEASE_TAG}/${archive_basename}"

  info "Downloading ${RELEASE_TAG} (${archive_basename})..."
  curl -fL "$archive_url" -o "$archive_path" || fail "Failed to download ${archive_url}"

  mkdir -p "$unpack_dir"
  tar -xzf "$archive_path" -C "$unpack_dir"
  extracted_dir="$unpack_dir/mya"
  [[ -d "$extracted_dir" ]] || fail "Release archive did not contain a top-level mya/ directory"

  rm -rf "$INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  mv "$extracted_dir" "$INSTALL_DIR"

  rm -rf "$tmp_root"
  ok "Installed release ${RELEASE_TAG} to $INSTALL_DIR"
}

install_from_release() {
  local connect_dir

  resolve_release_tag
  extract_release_archive
  connect_dir="$(connect_install_dir "$INSTALL_DIR")"

  if [[ -d "$connect_dir/node_modules" ]]; then
    CONNECT_READY="$CONNECT_SUPPORTED"
  elif [[ "$CONNECT_SUPPORTED" -eq 1 && -f "$connect_dir/package.json" ]]; then
    info "Installing bundled connector dependencies..."
    npm --prefix "$connect_dir" install
    CONNECT_READY=1
  else
    CONNECT_READY=0
  fi

  chmod +x "$INSTALL_DIR/bin/mya" "$INSTALL_DIR/cli" "$INSTALL_DIR/install.sh"
}

link_binary() {
  ln -sf "$INSTALL_DIR/bin/mya" "$LINK_DIR/mya"
  ok "Symlinked: $LINK_DIR/mya"

  if ! echo "${PATH:-}" | tr ':' '\n' | grep -qx "$LINK_DIR"; then
    warn "$LINK_DIR is not on your PATH"
    echo ""
    printf "${YELLOW}  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):${RESET}\n"
    printf "${BOLD}    export PATH=\"${LINK_DIR}:\$PATH\"${RESET}\n"
    echo ""
  fi
}

print_summary() {
  echo ""
  printf "${GREEN}${BOLD}  mya is ready!${RESET}\n"
  echo ""
  printf "  ${BOLD}Run it:${RESET}\n"
  printf "    ${CYAN}mya${RESET}                          # interactive REPL\n"
  printf "    ${CYAN}mya -p \"your prompt\"${RESET}          # one-shot mode\n"
  printf "    ${CYAN}mya update${RESET}                   # upgrade this installation\n"
  if [[ "$CONNECT_READY" -eq 1 ]]; then
    printf "    ${CYAN}mya wechat login${RESET}             # 微信扫码登录\n"
    printf "    ${CYAN}mya feishu check${RESET}             # 校验飞书应用凭证\n"
    printf "    ${CYAN}mya bots${RESET}                     # 查看已配置 bot\n"
    printf "    ${CYAN}mya serve status${RESET}             # 查看常驻服务状态\n"
    printf "    ${CYAN}cp ${CONNECT_CONFIG_DIR}/.env.hub.example ${CONNECT_CONFIG_DIR}/.env${RESET}   # bot 模板配置\n"
  else
    printf "    ${DIM}Install Node.js ${NODE_MIN_MAJOR}+ later if you want \`mya wechat\`, \`mya feishu\`, or multi-bot service.${RESET}\n"
  fi
  echo ""
  printf "  ${BOLD}Set your API key:${RESET}\n"
  printf "    ${CYAN}export ANTHROPIC_API_KEY=\"sk-ant-...\"${RESET}\n"
  echo ""
  printf "  ${DIM}Install mode: ${INSTALL_MODE}${RESET}\n"
  if [[ -n "$RELEASE_TAG" ]]; then
    printf "  ${DIM}Release tag: ${RELEASE_TAG}${RESET}\n"
  fi
  printf "  ${DIM}Install dir: ${INSTALL_DIR}${RESET}\n"
  printf "  ${DIM}Binary:      ${INSTALL_DIR}/cli${RESET}\n"
  printf "  ${DIM}Link:        ${LINK_DIR}/mya${RESET}\n"
  printf "  ${DIM}Hub env:     ${CONNECT_CONFIG_DIR}/.env.hub.example${RESET}\n"
  printf "  ${DIM}Hub profiles:${CONNECT_CONFIG_DIR}/examples/profiles${RESET}\n"
  echo ""
}

main() {
  parse_args "$@"
  header
  info "$([[ "$UPGRADE_ONLY" -eq 1 ]] && echo "Starting upgrade..." || echo "Starting installation...")"
  echo ""

  check_prerequisites
  detect_source_dir
  detect_mode
  check_os
  check_node
  ensure_parent_dir
  echo ""

  case "$INSTALL_MODE" in
    source)
      install_core_from_source
      ;;
    release)
      install_from_release
      ;;
    *)
      fail "Unsupported install mode: $INSTALL_MODE"
      ;;
  esac

  seed_hub_templates
  link_binary
  print_summary
}

main "$@"
