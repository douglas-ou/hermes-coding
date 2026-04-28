#!/usr/bin/env bash
#
# hermes-coding CLI Bootstrap Script
# Include this at the top of every skill that uses hermes-coding
#
# Usage in phase files:
#   source .claude/skills/hermes-coding/bootstrap-cli.sh
#
# This script will:
# 1. Check if hermes-coding CLI is globally installed
# 2. If not, install via npm install -g
# 3. Fall back to local build if global install fails
# 4. Validate CLI works correctly
#
# Environment variables:
#   SKIP_BOOTSTRAP=1   Skip automatic bootstrap (for testing)
#   FORCE_REBUILD=1    Force local rebuild (skip global, rebuild local)
#

set -euo pipefail

# ============================================================
# Color Output Helpers
# ============================================================

if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  CYAN=''
  BOLD=''
  NC=''
fi

# ============================================================
# Configuration
# ============================================================

HERMES_CODING_PACKAGE="hermes-coding"

# Determine project root for local fallback
HERMES_CODING_ROOT=""

if [ -d "$PWD/cli" ]; then
  HERMES_CODING_ROOT="$PWD"
elif [ -n "${BASH_SOURCE[0]:-}" ]; then
  HERMES_CODING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
else
  HERMES_CODING_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

LOCAL_CLI_PATH="${HERMES_CODING_ROOT}/cli/dist/index.js"
LOCAL_CLI_DIR="${HERMES_CODING_ROOT}/cli"

# ============================================================
# Logging helpers
# ============================================================

log_info() {
  echo -e "${BLUE}ℹ${NC} $*" >&2
}

log_success() {
  echo -e "${GREEN}✓${NC} $*" >&2
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
  echo -e "${RED}✗${NC} $*" >&2
}

log_step() {
  echo -e "${CYAN}▸${NC} $*" >&2
}

is_truthy() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# ============================================================
# CLI Detection Functions
# ============================================================

check_global_cli() {
  command -v hermes-coding &> /dev/null
}

get_global_version() {
  hermes-coding --version 2>/dev/null || echo "unknown"
}

check_local_cli_exists() {
  [ -f "$LOCAL_CLI_PATH" ]
}

check_local_dependencies_installed() {
  [ -d "${LOCAL_CLI_DIR}/node_modules" ]
}

validate_cli() {
  hermes-coding --version > /dev/null 2>&1
}

# ============================================================
# Auto-Update Functions
# ============================================================

# Cache file shared with the CLI's update-checker.service.ts
UPDATE_CACHE_DIR="${HERMES_CODING_CACHE_DIR:-$HOME/.config/configstore}"
UPDATE_CACHE_FILE="${UPDATE_CACHE_DIR}/hermes-coding-update-check.json"
UPDATE_CHECK_INTERVAL_SECS=$((24 * 60 * 60))  # 24 hours

# Read a field from the update cache JSON file (jq or grep fallback)
# Handles both quoted strings ("value") and unquoted numbers (12345).
# Usage: read_cache_field "latestVersion"
read_cache_field() {
  local field="$1"
  if [ ! -f "$UPDATE_CACHE_FILE" ]; then
    return 1
  fi
  if command -v jq &>/dev/null; then
    jq -r ".$field // empty" "$UPDATE_CACHE_FILE" 2>/dev/null
  else
    # Match "field": "value" (quoted) or "field": 12345 (unquoted number)
    local raw
    raw=$(grep -o "\"$field\"[[:space:]]*:[[:space:]]*[^,}]*" "$UPDATE_CACHE_FILE" 2>/dev/null | head -1)
    if [ -z "$raw" ]; then
      return 1
    fi
    # Extract value after colon, strip quotes and whitespace
    local val
    val=$(echo "$raw" | sed 's/[^:]*:[[:space:]]*//' | tr -d '"' | tr -d '[:space:]')
    echo "$val"
  fi
}

read_cache_field_or_empty() {
  local field="$1"
  local value=""
  value=$(read_cache_field "$field" || true)
  echo "$value"
}

# Check if cache is still valid (within 24h interval)
cache_is_fresh() {
  local last_checked
  last_checked=$(read_cache_field "lastChecked")
  if [ -z "$last_checked" ]; then
    return 1
  fi
  local now
  now=$(date +%s000)  # milliseconds
  local age=$(( now - last_checked ))
  [ "$age" -lt "$((UPDATE_CHECK_INTERVAL_SECS * 1000))" ]
}

# Compare semver versions: returns 0 if version $1 > version $2
version_gt() {
  local a="$1" b="$2"
  a="${a#v}" b="${b#v}"
  [ "$a" = "$b" ] && return 1

  local IFS='.'
  # shellcheck disable=SC2206
  local a_parts=($a) b_parts=($b)
  for i in 0 1 2; do
    local ai=${a_parts[$i]:-0} bi=${b_parts[$i]:-0}
    [ "$ai" -gt "$bi" ] && return 0
    [ "$ai" -lt "$bi" ] && return 1
  done
  return 1
}

# Check for updates and auto-update if needed.
# Runs only after global CLI is confirmed available.
# Fast path: reads cache file (<100ms). Slow path: npm install (~10s).
check_and_auto_update() {
  # Skip in special modes
  [ "${FORCE_REBUILD:-0}" = "1" ] && return 0
  [ "${SKIP_BOOTSTRAP:-0}" = "1" ] && return 0
  is_truthy "${CI:-}" && return 0
  [ "${NO_UPDATE_NOTIFIER:-}" = "1" ] && return 0

  # Skip if hermes-coding is a shell function (local build mode),
  # not a real global binary. command -v returns just the name for
  # functions, but a path containing "/" for real binaries.
  local resolved
  resolved=$(command -v hermes-coding 2>/dev/null) || return 0
  [[ "$resolved" != */* ]] && return 0

  # Get installed version
  local installed_version
  installed_version=$(hermes-coding --version 2>/dev/null | tr -d 'v')
  [ -z "$installed_version" ] && return 0

  local latest_version installed_cache_version

  if cache_is_fresh; then
    latest_version=$(read_cache_field_or_empty "latestVersion")
    installed_cache_version=$(read_cache_field_or_empty "installedVersion")

    # Already installed the latest? Fast path done.
    if [ -n "$latest_version" ] \
      && [ -n "$installed_cache_version" ] \
      && [ "$installed_cache_version" = "$latest_version" ] \
      && [ "$installed_version" = "$latest_version" ]; then
      return 0
    fi

    # Cache is fresh and a newer CLI is known.
    # Even if the CLI is already updated, a missing installedVersion means
    # the previous auto-update likely failed during skills sync, so retry --auto.
    if [ -z "$latest_version" ]; then
      return 0
    fi
  else
    # Cache expired: ask CLI to check and refresh cache
    local check_output
    check_output=$(NO_UPDATE_NOTIFIER=1 hermes-coding update --check --json 2>/dev/null) || return 0
    latest_version=$(echo "$check_output" | grep -o '"latestVersion"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:.*"\(.*\)"/\1/')
    installed_cache_version=$(read_cache_field_or_empty "installedVersion")

    # No update needed
    if [ -z "$latest_version" ] || [ "$latest_version" = "$installed_version" ]; then
      return 0
    fi
  fi

  # Update available — install it, or retry completion when CLI is already latest
  # but the cache still lacks installedVersion after a prior skills sync failure.
  if version_gt "$latest_version" "$installed_version" || {
    [ "$latest_version" = "$installed_version" ] && [ "$installed_cache_version" != "$latest_version" ]
  }; then
    log_step "Auto-updating hermes-coding: ${installed_version} -> ${latest_version}"
    HERMES_CODING_AUTO_UPDATE=1 hermes-coding update --auto --target-version "$latest_version" >/dev/null 2>/dev/null || {
      log_warning "Auto-update failed, continuing with v${installed_version}"
      return 0
    }
    local new_version
    new_version=$(hermes-coding --version 2>/dev/null || echo "unknown")
    log_success "Updated to ${new_version}"
  fi
}

check_node_version() {
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    log_error "hermes-coding requires Node.js >= 18.0.0"
    log_error "Install from: https://nodejs.org/"
    return 1
  fi

  local node_version major_version
  node_version=$(node --version | sed 's/v//')
  major_version=$(echo "$node_version" | cut -d. -f1)

  if [ "$major_version" -lt 18 ]; then
    log_error "Node.js version $node_version is too old"
    log_error "hermes-coding requires Node.js >= 18.0.0"
    return 1
  fi

  return 0
}

# ============================================================
# Installation Functions
# ============================================================

install_global_cli() {
  log_step "Installing hermes-coding globally..."

  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}📦 Installing hermes-coding CLI${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if ! check_node_version; then
    return 1
  fi

  if npm install -g "$HERMES_CODING_PACKAGE" 2>&1 | grep -v "^npm WARN"; then
    if check_global_cli && validate_cli; then
      log_success "hermes-coding installed globally: $(get_global_version)"
      return 0
    fi
  fi

  log_warning "Global installation failed, will use local build fallback"
  return 1
}

build_local_cli() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}🔧 Building hermes-coding CLI (local)${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if ! check_node_version; then
    return 1
  fi

  if ! check_local_dependencies_installed; then
    log_step "Installing dependencies..."
    cd "$LOCAL_CLI_DIR"

    if [ -f "package-lock.json" ]; then
      npm ci --silent --no-progress 2>&1 | grep -v "^npm WARN" || \
        npm install --silent --no-progress 2>&1 | grep -v "^npm WARN" || true
    else
      npm install --silent --no-progress 2>&1 | grep -v "^npm WARN" || true
    fi

    if [ ! -d "node_modules" ]; then
      log_error "Failed to install dependencies"
      return 1
    fi
    log_success "Dependencies installed"
  fi

  log_step "Compiling TypeScript..."
  cd "$LOCAL_CLI_DIR"

  if npm run build --silent 2>&1 | grep -E "error TS|Build failed" >&2; then
    log_error "TypeScript compilation failed"
    return 1
  fi

  if [ -f "$LOCAL_CLI_PATH" ]; then
    chmod +x "$LOCAL_CLI_PATH"
    log_success "CLI compiled successfully"
    return 0
  else
    log_error "Build succeeded but output file not found"
    return 1
  fi
}

# ============================================================
# Main Bootstrap Logic
# ============================================================

bootstrap_hermes_coding_cli() {
  local force_rebuild="${FORCE_REBUILD:-0}"

  # Skip bootstrap if requested
  if [ "${SKIP_BOOTSTRAP:-0}" = "1" ]; then
    log_info "Bootstrap skipped (SKIP_BOOTSTRAP=1)"
    return 0
  fi

  # ═══════════════════════════════════════════
  # OPTION 1: Use global CLI (preferred)
  # ═══════════════════════════════════════════

  if [ "$force_rebuild" != "1" ]; then
    if check_global_cli && validate_cli; then
      check_and_auto_update
      return 0
    fi
  fi

  # ═══════════════════════════════════════════
  # OPTION 2: Install globally (if not forcing rebuild)
  # ═══════════════════════════════════════════

  if [ "$force_rebuild" != "1" ]; then
    log_info "hermes-coding CLI not found globally"

    if install_global_cli; then
      return 0
    fi

    log_warning "Falling back to local build..."
  fi

  # ═══════════════════════════════════════════
  # OPTION 3: Use/build local CLI (fallback or forced)
  # ═══════════════════════════════════════════

  # Check if local CLI exists and works (unless forcing rebuild)
  if [ "$force_rebuild" != "1" ] && check_local_cli_exists; then
    hermes-coding() {
      node "$LOCAL_CLI_PATH" "$@"
    }
    export -f hermes-coding

    if validate_cli; then
      log_success "hermes-coding CLI ready (local build)"
      return 0
    fi
  fi

  # Build local CLI
  if ! build_local_cli; then
    log_error "CRITICAL: CLI build failed"
    log_error ""
    log_error "Please report this issue:"
    log_error "  https://github.com/douglas-ou/hermes-coding/issues"
    log_error ""
    log_error "Include this information:"
    log_error "  - Node.js version: $(node --version 2>&1 || echo 'not found')"
    log_error "  - npm version: $(npm --version 2>&1 || echo 'not found')"
    log_error "  - OS: $(uname -s) $(uname -r)"
    return 1
  fi

  # Create wrapper function for local CLI
  hermes-coding() {
    node "$LOCAL_CLI_PATH" "$@"
  }
  export -f hermes-coding

  if validate_cli; then
    log_success "hermes-coding CLI ready (local build)"
    return 0
  else
    log_error "CRITICAL: CLI validation failed after build"
    return 1
  fi
}

# ============================================================
# Exported Functions
# ============================================================

if ! command -v hermes-coding &> /dev/null; then
  hermes-coding() {
    if [ -f "$LOCAL_CLI_PATH" ]; then
      node "$LOCAL_CLI_PATH" "$@"
    else
      log_error "hermes-coding CLI not found"
      return 1
    fi
  }
  export -f hermes-coding
fi

# ============================================================
# Auto-Execute Bootstrap
# ============================================================

if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "${0}" ]; then
  bootstrap_hermes_coding_cli
elif [ -z "${BASH_SOURCE[0]:-}" ]; then
  bootstrap_hermes_coding_cli
else
  echo "Bootstrap script loaded. Run: bootstrap_hermes_coding_cli"
fi
