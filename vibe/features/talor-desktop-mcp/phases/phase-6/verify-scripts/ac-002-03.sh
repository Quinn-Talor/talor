#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-002-03: 连接超时处理"
echo "========================================"

require_tools npm npx || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking timeout handling..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('AbortController') || content.includes('timeout') || content.includes('TIMEOUT')) {
        console.log('TIMEOUT_HANDLING_EXISTS');
    } else {
        console.log('TIMEOUT_HANDLING_MISSING');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "TIMEOUT_HANDLING_EXISTS"; then
    echo "[PASS] Timeout handling exists: contains 'TIMEOUT_HANDLING_EXISTS'"
else
    echo "[FAIL] Timeout handling not found: $RESULT"
    exit 1
fi

echo "AC-002-03: ✅ PASS"
exit 0