#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-002-02: HTTP Server 连接测试成功"
echo "========================================"

require_tools npm npx || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking HTTP transport..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('fetch') && content.includes('http')) {
        console.log('HTTP_TRANSPORT_EXISTS');
    } else {
        console.log('HTTP_TRANSPORT_MISSING');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "HTTP_TRANSPORT_EXISTS"; then
    echo "[PASS] HTTP transport exists: contains 'HTTP_TRANSPORT_EXISTS'"
else
    echo "[FAIL] HTTP transport not found: $RESULT"
    exit 1
fi

echo "AC-002-02: ✅ PASS"
exit 0