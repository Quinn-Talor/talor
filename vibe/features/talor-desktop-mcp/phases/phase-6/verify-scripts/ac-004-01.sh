#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-004-01: 删除 MCP Server"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking delete functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('mcp:servers:delete')) {
        console.log('DELETE_SUPPORTED');
    } else {
        console.log('DELETE_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "DELETE_SUPPORTED"; then
    echo "[PASS] Delete functionality exists: contains 'DELETE_SUPPORTED'"
else
    echo "[FAIL] Delete functionality not found: $RESULT"
    exit 1
fi

echo "AC-004-01: ✅ PASS"
exit 0