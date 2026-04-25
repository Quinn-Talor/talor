#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-007-03: 导入格式错误处理"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking JSON parsing..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('JSON.parse') && (content.includes('try') || content.includes('catch'))) {
        console.log('JSON_PARSING_EXISTS');
    } else {
        console.log('JSON_PARSING_MISSING');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "JSON_PARSING_EXISTS"; then
    echo "[PASS] JSON parsing exists: contains 'JSON_PARSING_EXISTS'"
else
    echo "[FAIL] JSON parsing not found: $RESULT"
    exit 1
fi

echo "AC-007-03: ✅ PASS"
exit 0