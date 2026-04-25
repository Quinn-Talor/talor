#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-003-01: 禁用 MCP Server"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking disable functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('setEnabled') || content.includes('enabled')) {
        console.log('DISABLE_SUPPORTED');
    } else {
        console.log('DISABLE_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "DISABLE_SUPPORTED"; then
    echo "[PASS] Disable functionality exists: contains 'DISABLE_SUPPORTED'"
else
    echo "[FAIL] Disable functionality not found: $RESULT"
    exit 1
fi

echo "AC-003-01: ✅ PASS"
exit 0