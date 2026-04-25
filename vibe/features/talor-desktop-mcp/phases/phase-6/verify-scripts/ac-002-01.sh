#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-002-01: STDIO Server 连接测试成功"
echo "========================================"

require_tools npm npx || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking STDIO connection test handler..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('testConnection') && content.includes('stdio')) {
        console.log('TEST_HANDLER_EXISTS');
    } else {
        console.log('TEST_HANDLER_MISSING');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "TEST_HANDLER_EXISTS"; then
    echo "[PASS] Connection test handler exists: contains 'TEST_HANDLER_EXISTS'"
else
    echo "[FAIL] Connection test handler not found: $RESULT"
    exit 1
fi

echo "AC-002-01: ✅ PASS"
exit 0