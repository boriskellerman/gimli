#!/usr/bin/env bash
#
# Gimli Linux Server Setup Script
#
# One-liner usage:
#   curl -fsSL https://gimli.bot/setup-linux.sh | bash
#
# Or with options:
#   curl -fsSL https://gimli.bot/setup-linux.sh | bash -s -- --help
#
# This script:
#   1. Verifies Node.js 22+ is installed (prompts to install via nvm if not)
#   2. Installs Gimli globally via npm
#   3. Runs onboarding with systemd daemon installation
#   4. Enables user linger for boot auto-start
#   5. Verifies security configuration
#
# Requirements:
#   - Linux (Ubuntu/Debian, RHEL/Fedora, or similar)
#   - bash 4.0+
#   - curl or wget
#   - systemd (for daemon management)
#
set -euo pipefail

# Constants
readonly REQUIRED_NODE_MAJOR=22
readonly GIMLI_DEFAULT_PORT=18789
readonly SCRIPT_NAME="gimli-setup-linux"

# Colors (if terminal supports them)
if [[ -t 1 ]]; then
  readonly RED='\033[0;31m'
  readonly GREEN='\033[0;32m'
  readonly YELLOW='\033[0;33m'
  readonly BLUE='\033[0;34m'
  readonly NC='\033[0m' # No Color
else
  readonly RED=''
  readonly GREEN=''
  readonly YELLOW=''
  readonly BLUE=''
  readonly NC=''
fi

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_success() { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Parse command line arguments
SKIP_NODE_CHECK=false
SKIP_ONBOARD=false
DRY_RUN=false
VERBOSE=false

print_usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [OPTIONS]

Gimli Linux Server Setup Script

Options:
  --skip-node-check    Skip Node.js version verification
  --skip-onboard       Skip onboarding (install only)
  --dry-run            Print what would be done without making changes
  --verbose            Enable verbose output
  --help               Show this help message

Environment Variables:
  GIMLI_SKIP_NODE_CHECK=1    Skip Node.js version verification
  GIMLI_SKIP_ONBOARD=1       Skip onboarding
  GIMLI_DRY_RUN=1            Dry run mode
  GIMLI_VERBOSE=1            Verbose output

Examples:
  # Full setup
  curl -fsSL https://gimli.bot/setup-linux.sh | bash

  # Skip onboarding
  curl -fsSL https://gimli.bot/setup-linux.sh | bash -s -- --skip-onboard

  # Dry run
  curl -fsSL https://gimli.bot/setup-linux.sh | bash -s -- --dry-run
EOF
}

parse_args() {
  # Check environment variables first
  [[ "${GIMLI_SKIP_NODE_CHECK:-}" == "1" ]] && SKIP_NODE_CHECK=true
  [[ "${GIMLI_SKIP_ONBOARD:-}" == "1" ]] && SKIP_ONBOARD=true
  [[ "${GIMLI_DRY_RUN:-}" == "1" ]] && DRY_RUN=true
  [[ "${GIMLI_VERBOSE:-}" == "1" ]] && VERBOSE=true

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-node-check) SKIP_NODE_CHECK=true; shift ;;
      --skip-onboard) SKIP_ONBOARD=true; shift ;;
      --dry-run) DRY_RUN=true; shift ;;
      --verbose) VERBOSE=true; shift ;;
      --help|-h) print_usage; exit 0 ;;
      *)
        log_error "Unknown option: $1"
        print_usage
        exit 1
        ;;
    esac
  done
}

# Check if running on Linux
check_platform() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    log_error "This script is for Linux only. Detected: $(uname -s)"
    log_info "For macOS, use: curl -fsSL https://gimli.bot/install.sh | bash"
    exit 1
  fi
  log_success "Platform: Linux"
}

# Check if systemd is available
check_systemd() {
  if ! command -v systemctl &>/dev/null; then
    log_warn "systemd not found. Daemon auto-start will not be configured."
    return 1
  fi
  log_success "systemd available"
  return 0
}

# Get installed Node.js major version (returns 0 if not installed)
get_node_major_version() {
  if ! command -v node &>/dev/null; then
    echo "0"
    return
  fi
  local version
  version=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  echo "${version:-0}"
}

# Check Node.js version
check_node() {
  if [[ "$SKIP_NODE_CHECK" == "true" ]]; then
    log_warn "Skipping Node.js version check"
    return 0
  fi

  local node_version
  node_version=$(get_node_major_version)

  if [[ "$node_version" -ge "$REQUIRED_NODE_MAJOR" ]]; then
    log_success "Node.js v$(node --version) meets requirement (>= v$REQUIRED_NODE_MAJOR)"
    return 0
  fi

  if [[ "$node_version" -eq "0" ]]; then
    log_error "Node.js is not installed"
  else
    log_error "Node.js v$(node --version) is too old (requires >= v$REQUIRED_NODE_MAJOR)"
  fi

  echo ""
  log_info "Install Node.js $REQUIRED_NODE_MAJOR+ using one of these methods:"
  echo ""
  echo "  1) Using nvm (recommended):"
  echo "     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
  echo "     source ~/.bashrc"
  echo "     nvm install $REQUIRED_NODE_MAJOR"
  echo "     nvm use $REQUIRED_NODE_MAJOR"
  echo ""
  echo "  2) Using NodeSource (Debian/Ubuntu):"
  echo "     curl -fsSL https://deb.nodesource.com/setup_$REQUIRED_NODE_MAJOR.x | sudo -E bash -"
  echo "     sudo apt-get install -y nodejs"
  echo ""
  echo "  3) Using NodeSource (RHEL/Fedora):"
  echo "     curl -fsSL https://rpm.nodesource.com/setup_$REQUIRED_NODE_MAJOR.x | sudo bash -"
  echo "     sudo dnf install -y nodejs"
  echo ""
  log_info "After installing Node.js, re-run this script."
  exit 1
}

# Check if npm global bin is in PATH
check_npm_path() {
  local npm_prefix
  npm_prefix=$(npm prefix -g 2>/dev/null || echo "")

  if [[ -z "$npm_prefix" ]]; then
    log_warn "Could not determine npm global prefix"
    return 0
  fi

  local npm_bin="$npm_prefix/bin"
  if [[ ":$PATH:" != *":$npm_bin:"* ]]; then
    log_warn "npm global bin directory not in PATH: $npm_bin"
    log_info "Add to your shell profile: export PATH=\"$npm_bin:\$PATH\""
  fi
}

# Install Gimli
install_gimli() {
  log_info "Installing Gimli..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: npm install -g gimli@latest"
    return 0
  fi

  # Check if already installed
  if command -v gimli &>/dev/null; then
    local current_version
    current_version=$(gimli --version 2>/dev/null || echo "unknown")
    log_info "Gimli already installed (version: $current_version). Upgrading..."
  fi

  # Install with SHARP_IGNORE_GLOBAL_LIBVIPS to avoid sharp build issues
  if SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g gimli@latest; then
    log_success "Gimli installed successfully"
  else
    log_error "Failed to install Gimli"
    log_info "Try running: SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install -g gimli@latest"
    exit 1
  fi
}

# Run onboarding
run_onboard() {
  if [[ "$SKIP_ONBOARD" == "true" ]]; then
    log_info "Skipping onboarding (--skip-onboard)"
    return 0
  fi

  log_info "Running Gimli onboarding..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: gimli onboard --install-daemon"
    return 0
  fi

  if gimli onboard --install-daemon; then
    log_success "Onboarding completed"
  else
    log_warn "Onboarding had warnings (this may be normal for fresh installs)"
  fi
}

# Enable user linger for systemd
enable_linger() {
  if ! check_systemd; then
    return 0
  fi

  log_info "Enabling user linger for boot auto-start..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: loginctl enable-linger"
    return 0
  fi

  # Check current linger status
  local linger_status
  linger_status=$(loginctl show-user "$USER" 2>/dev/null | grep -i "^Linger=" | cut -d= -f2 || echo "no")

  if [[ "${linger_status,,}" == "yes" ]]; then
    log_success "User linger already enabled"
    return 0
  fi

  if loginctl enable-linger 2>/dev/null; then
    log_success "User linger enabled"
  else
    log_warn "Could not enable user linger (may require sudo)"
    log_info "Run manually: sudo loginctl enable-linger $USER"
  fi
}

# Run doctor to verify setup
run_doctor() {
  log_info "Running Gimli doctor..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would run: gimli doctor"
    return 0
  fi

  if ! command -v gimli &>/dev/null; then
    log_warn "Gimli not found in PATH, skipping doctor"
    return 0
  fi

  if gimli doctor; then
    log_success "Doctor checks passed"
  else
    log_warn "Doctor reported issues (review output above)"
  fi
}

# Verify security settings
verify_security() {
  log_info "Verifying security configuration..."

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] Would verify security settings"
    return 0
  fi

  local issues=0

  # Check credentials directory permissions
  local creds_dir="$HOME/.gimli/credentials"
  if [[ -d "$creds_dir" ]]; then
    local perms
    perms=$(stat -c '%a' "$creds_dir" 2>/dev/null || echo "unknown")
    if [[ "$perms" == "700" ]]; then
      log_success "Credentials directory permissions: $perms"
    else
      log_warn "Credentials directory permissions: $perms (should be 700)"
      ((issues++))
    fi
  fi

  # Check gateway bind address
  if command -v gimli &>/dev/null && command -v ss &>/dev/null; then
    if ss -ltnp 2>/dev/null | grep -q ":$GIMLI_DEFAULT_PORT.*127.0.0.1"; then
      log_success "Gateway binds to loopback only"
    elif ss -ltnp 2>/dev/null | grep -q ":$GIMLI_DEFAULT_PORT"; then
      log_warn "Gateway may be exposed on non-loopback interface"
      ((issues++))
    fi
  fi

  if [[ "$issues" -eq 0 ]]; then
    log_success "Security verification passed"
  else
    log_warn "Found $issues security issue(s) - review warnings above"
  fi
}

# Print summary
print_summary() {
  echo ""
  echo "========================================"
  echo "  Gimli Linux Setup Complete"
  echo "========================================"
  echo ""

  if command -v gimli &>/dev/null; then
    echo "  Version: $(gimli --version 2>/dev/null || echo 'unknown')"
  fi

  echo ""
  echo "  Next steps:"
  echo "    1. Configure model provider credentials:"
  echo "       gimli models auth paste-token --provider anthropic"
  echo ""
  echo "    2. Test the agent:"
  echo "       gimli agent --message \"Hello\" --thinking low"
  echo ""
  echo "    3. Check gateway status:"
  echo "       gimli status"
  echo ""
  echo "    4. Run diagnostics:"
  echo "       gimli doctor"
  echo ""
  echo "  Documentation: https://docs.gimli.bot"
  echo ""
}

# Main function
main() {
  parse_args "$@"

  echo ""
  log_info "Gimli Linux Server Setup"
  echo ""

  check_platform
  check_node
  check_npm_path
  install_gimli
  run_onboard
  enable_linger
  run_doctor
  verify_security
  print_summary
}

# Run main
main "$@"
