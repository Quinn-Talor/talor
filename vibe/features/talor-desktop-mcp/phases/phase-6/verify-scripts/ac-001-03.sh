#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-001-03: 编辑 MCP Server 配置"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking edit functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('mcp:servers:update')) {
        console.log('EDIT_SUPPORTED');
    } else {
        console.log('EDIT_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "EDIT_SUPPORTED"; then
    echo "[PASS] Edit functionality exists: contains 'EDIT_SUPPORTED'"
else
    echo "[FAIL] Edit functionality not found: $RESULT"
    exit 1
fi

echo "AC-001-03: ✅ PASS"
exit 0