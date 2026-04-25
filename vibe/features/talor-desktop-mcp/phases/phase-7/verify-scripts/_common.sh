#!/bin/bash
# _common.sh - Common helper functions for Phase 7 verification

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running in CI environment
is_ci() {
    [ "$CI" = "true" ]
}

# Get script directory
get_script_dir() {
    cd "$(dirname "$0")" && pwd
}

# Check tool availability
check_tool() {
    local tool=$1
    if ! command -v "$tool" &> /dev/null; then
        log_error "Required tool not found: $tool"
        return 1
    fi
    return 0
}

# Export common functions
export -f log_info log_warn log_error is_ci get_script_dir check_tool
