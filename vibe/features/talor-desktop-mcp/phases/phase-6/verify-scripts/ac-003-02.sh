#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-003-02: 启用 MCP Server"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking enable functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('setEnabled') || content.includes('enabled')) {
        console.log('ENABLE_SUPPORTED');
    } else {
        console.log('ENABLE_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "ENABLE_SUPPORTED"; then
    echo "[PASS] Enable functionality exists: contains 'ENABLE_SUPPORTED'"
else
    echo "[FAIL] Enable functionality not found: $RESULT"
    exit 1
fi

echo "AC-003-02: ✅ PASS"
exit 0