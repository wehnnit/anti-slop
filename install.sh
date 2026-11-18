#!/usr/bin/env bash
set -euo pipefail

REPO="https://github.com/wehnnit/anti-slop.git"
SUPPORT="$HOME/Library/Application Support/Anti-Slop-WEHNIT_STUDIOS"
INSTALL_DIR="$SUPPORT/app"
LAUNCHER="$SUPPORT/bin/antiSL"
PROFILE_LINE="export PATH=\"$SUPPORT/bin:\$PATH\""

paper() { printf '\033[38;5;180m%s\033[0m\n' "$1"; }
ink()   { printf '\033[1m%s\033[0m\n' "$1"; }
dim()   { printf '\033[2m%s\033[0m\n' "$1"; }
fail()  { printf '\033[38;5;166m%s\033[0m\n' "$1" >&2; exit 1; }

step() { printf '  \033[2m%s\033[0m %s\n' "$1" "$2"; }

banner() {
  printf '\n'
  printf '  \033[1mANTI-SLOP\033[0m \033[2m/ local coding harness\033[0m\n'
  printf '  \033[2m----------------------------------------\033[0m\n\n'
}

require_macos() {
  [ "$(uname -s)" = "Darwin" ] || fail "Anti-Slop targets macOS. Detected $(uname -s)."
}

require_node() {
  command -v node >/dev/null 2>&1 || fail "Node.js is missing. Install Node 22.4 or newer from https://nodejs.org and run this again."
  local version major minor
  version="$(node -p 'process.versions.node')"
  major="${version%%.*}"
  minor="${version#*.}"; minor="${minor%%.*}"
  if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 4 ]; }; then
    fail "Node ${version} is too old. Anti-Slop needs 22.4 or newer."
  fi
  step "node" "${version}"
}

require_tools() {
  command -v git >/dev/null 2>&1 || fail "git is missing. Run: xcode-select --install"
  command -v npm >/dev/null 2>&1 || fail "npm is missing. Reinstall Node.js."
}

stage_source() {
  mkdir -p "$SUPPORT" "$SUPPORT/bin"
  if [ -d "$INSTALL_DIR/.git" ]; then
    step "update" "refreshing existing checkout"
    git -C "$INSTALL_DIR" fetch --depth 1 origin main >/dev/null 2>&1 || true
    git -C "$INSTALL_DIR" reset --hard origin/main >/dev/null 2>&1 || true
  else
    if [ "$(cd "$(dirname "$0")" 2>/dev/null && pwd)" = "$(pwd)" ] && [ -f "package.json" ] && grep -q '"name": "anti-slop"' package.json 2>/dev/null; then
      step "source" "installing from the current folder"
      rm -rf "$INSTALL_DIR"
      mkdir -p "$INSTALL_DIR"
      cp -R ./bin ./src ./web ./assets ./scripts ./package.json ./tsconfig.json ./README.md ./LICENSE "$INSTALL_DIR/" 2>/dev/null || true
    else
      step "source" "cloning $REPO"
      rm -rf "$INSTALL_DIR"
      git clone --depth 1 "$REPO" "$INSTALL_DIR" >/dev/null 2>&1 || fail "Could not clone $REPO. Check your network or the repository URL."
    fi
  fi
}

build() {
  step "build" "installing dependencies"
  ( cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 ) || true
  ( cd "$INSTALL_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || fail "npm install failed inside $INSTALL_DIR."
  step "build" "compiling server and dashboard"
  ( cd "$INSTALL_DIR" && npm run build >/dev/null 2>&1 ) || fail "Build failed. Run \"npm run build\" in $INSTALL_DIR to see the error."
}

write_launcher() {
  mkdir -p "$(dirname "$LAUNCHER")"
  cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/antiSL.js" "\$@"
LAUNCHER_EOF
  chmod +x "$LAUNCHER"
  step "launcher" "$LAUNCHER"
}

wire_path() {
  local profile=""
  case "${SHELL:-/bin/zsh}" in
    */zsh) profile="$HOME/.zshrc" ;;
    */bash) profile="$HOME/.bash_profile" ;;
    *) profile="$HOME/.profile" ;;
  esac
  touch "$profile"
  if ! grep -Fq "$SUPPORT/bin" "$profile"; then
    {
      printf '\n# Anti-Slop\n'
      printf '%s\n' "$PROFILE_LINE"
    } >> "$profile"
    step "shell" "added $SUPPORT/bin to PATH in $profile"
    NEEDS_RELOAD=1
  else
    step "shell" "PATH already configured"
  fi
}

initialise_store() {
  node "$INSTALL_DIR/bin/antiSL.js" where >/dev/null 2>&1 || fail "The launcher cannot start. Run \"node $INSTALL_DIR/bin/antiSL.js --help\" to see why."
  step "state" "$SUPPORT"
}

main() {
  NEEDS_RELOAD=0
  banner
  require_macos
  require_node
  require_tools
  stage_source
  build
  write_launcher
  wire_path
  initialise_store

  printf '\n'
  ink "  Installed."
  dim  "  Support folder: $SUPPORT"
  dim  "  Deleting that folder removes Anti-Slop completely."
  printf '\n'
  if [ "$NEEDS_RELOAD" -eq 1 ]; then
    printf '  Open a new terminal, then run:\n\n    \033[1mantiSL\033[0m\n\n'
    dim "  Or use this shell right now:  source \"$HOME/.zshrc\""
  else
    printf '  Start it with:\n\n    \033[1mantiSL\033[0m\n'
  fi
  printf '\n'
}

main "$@"
