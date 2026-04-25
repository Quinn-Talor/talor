#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "========================================="
echo "Environment Setup for MCP Phase 6"
echo "========================================="

echo "[Step 1] Checking required tools..."
require_tools npm npx node || exit 1

echo "[Step 2] Checking environment..."
TALOR_PATH=$(get_talor_desktop_path)
if [[ ! -d "$TALOR_PATH" ]]; then
    echo "[ERROR] talor-desktop not found at $TALOR_PATH"
    exit 1
fi
echo "[OK] talor-desktop found at $TALOR_PATH"

echo "[Step 3] Checking database..."
DB_PATH=$(get_db_path)
if [[ -f "$DB_PATH" ]]; then
    echo "[OK] Database exists at $DB_PATH"
else
    echo "[INFO] Database not initialized yet"
fi

echo ""
echo "========================================="
echo "Environment setup complete!"
echo "========================================="