#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# Override this when you rehost the repo under your own mya repository URL.
REPO="${MYA_REPO_URL:-https://github.com/flowxai/mya.git}"
INSTALL_DIR="${MYA_INSTALL_DIR:-$HOME/mya}"
CONNECT_DIR="$INSTALL_DIR/connect"
BUN_MIN_VERSION="1.3.11"
NODE_MIN_MAJOR="22"
CONNECT_READY=0

info()  { printf "${CYAN}[*]${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$*"; }
fail()  { printf "${RED}[x]${RESET} %s\n" "$*"; exit 1; }

header() {
  echo ""
  printf "${BOLD}${CYAN}"
  cat << 'ART'
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

check_os() {
  case "$(uname -s)" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    *)      fail "Unsupported OS: $(uname -s). macOS or Linux required." ;;
  esac
  ok "OS: $(uname -s) $(uname -m)"
}

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    fail "git is not installed. Install it first."
  fi
  ok "git: $(git --version | head -1)"
}

version_gte() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -1)" = "$2" ]
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
  if ! command -v bun >/dev/null 2>&1; then
    fail "bun installation succeeded but binary not found on PATH.
Add this to your shell profile and restart:
  export PATH=\"\$HOME/.bun/bin:\$PATH\""
  fi
  ok "bun: v$(bun --version) (just installed)"
}

check_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "Node.js + npm not found. Base mya will work, but \`mya connect\` will stay disabled."
    return
  fi

  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
    warn "Node.js v$(node --version) found, but v${NODE_MIN_MAJOR}+ is required for \`mya connect\`."
    return
  fi

  CONNECT_READY=1
  ok "node: $(node --version)"
  ok "npm:  $(npm --version)"
}

clone_repo() {
  if [ -d "$INSTALL_DIR" ]; then
    warn "$INSTALL_DIR already exists"
    if [ -d "$INSTALL_DIR/.git" ]; then
      info "Pulling latest changes..."
      git -C "$INSTALL_DIR" pull --ff-only origin main 2>/dev/null || warn "Pull failed, continuing with existing copy"
    fi
  else
    info "Cloning repository..."
    git clone --depth 1 "$REPO" "$INSTALL_DIR"
  fi
  ok "Source: $INSTALL_DIR"
}

install_core_deps() {
  info "Installing core dependencies..."
  cd "$INSTALL_DIR"
  bun install --frozen-lockfile 2>/dev/null || bun install
  ok "Core dependencies installed"
}

install_connect_deps() {
  if [ "$CONNECT_READY" -ne 1 ]; then
    warn "Skipping bundled connector dependencies."
    return
  fi
  if [ ! -f "$CONNECT_DIR/package.json" ]; then
    warn "Bundled connect package not found at $CONNECT_DIR. \`mya connect\` will be unavailable."
    CONNECT_READY=0
    return
  fi

  info "Installing bundled connector dependencies..."
  npm --prefix "$CONNECT_DIR" install
  ok "Bundled connector dependencies installed"
}

build_binary() {
  info "Building mya..."
  cd "$INSTALL_DIR"
  bun run build
  ok "Binary built: $INSTALL_DIR/cli"
}

link_binary() {
  local link_dir="$HOME/.local/bin"
  mkdir -p "$link_dir"

  ln -sf "$INSTALL_DIR/bin/mya" "$link_dir/mya"
  ok "Symlinked: $link_dir/mya"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$link_dir"; then
    warn "$link_dir is not on your PATH"
    echo ""
    printf "${YELLOW}  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):${RESET}\n"
    printf "${BOLD}    export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n"
    echo ""
  fi
}

print_summary() {
  echo ""
  printf "${GREEN}${BOLD}  Installation complete!${RESET}\n"
  echo ""
  printf "  ${BOLD}Run it:${RESET}\n"
  printf "    ${CYAN}mya${RESET}                          # interactive REPL\n"
  printf "    ${CYAN}mya -p \"your prompt\"${RESET}          # one-shot mode\n"
  if [ "$CONNECT_READY" -eq 1 ]; then
    printf "    ${CYAN}mya connect wechat login${RESET}     # start微信扫码登录\n"
    printf "    ${CYAN}mya connect feishu check${RESET}     # 校验飞书应用凭证\n"
  else
    printf "    ${DIM}Install Node.js ${NODE_MIN_MAJOR}+ later if you want \`mya connect\`.${RESET}\n"
  fi
  echo ""
  printf "  ${BOLD}Set your API key:${RESET}\n"
  printf "    ${CYAN}export ANTHROPIC_API_KEY=\"sk-ant-...\"${RESET}\n"
  echo ""
  printf "  ${DIM}Source: $INSTALL_DIR${RESET}\n"
  printf "  ${DIM}Binary: $INSTALL_DIR/cli${RESET}\n"
  printf "  ${DIM}Link:   ~/.local/bin/mya${RESET}\n"
  if [ "$CONNECT_READY" -eq 1 ]; then
    printf "  ${DIM}Connect: $CONNECT_DIR${RESET}\n"
  fi
  echo ""
}

header
info "Starting installation..."
echo ""

check_os
check_git
check_bun
check_node
echo ""

clone_repo
install_core_deps
install_connect_deps
build_binary
link_binary
print_summary
