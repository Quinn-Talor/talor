#!/bin/bash
# _env-setup.sh - Environment setup for Phase 7 verification

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Setting up Phase 7 verification environment..."

check_tool "node" || exit 1
check_tool "npm" || exit 1
check_tool "npx" || exit 1

log_info "Environment setup complete"
