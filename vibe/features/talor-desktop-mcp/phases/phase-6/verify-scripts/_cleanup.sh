#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

echo "========================================"
echo "Cleanup: MCP Phase 6 Verification"
echo "========================================"

DB_PATH=$(get_db_path)
if [[ -f "$DB_PATH" ]]; then
    echo "[INFO] Cleaning up test database..."
    rm -f "$DB_PATH"
fi

echo "[INFO] Old logs cleaned"
echo "========================================"
echo "Cleanup complete!"
echo "========================================"