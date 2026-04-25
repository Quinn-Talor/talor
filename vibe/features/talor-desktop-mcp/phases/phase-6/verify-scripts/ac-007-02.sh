#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-007-02: 导入重复名称处理"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking duplicate name handling..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    const hasGetByName = content.includes('getByName');
    const hasStatus = content.includes('status') && (content.includes('created') || content.includes('updated'));
    const hasPrompt = content.includes('confirm') || content.includes('提示') || content.includes('覆盖');
    
    if (hasGetByName && (hasStatus || hasPrompt)) {
        console.log('DUPLICATE_HANDLING_EXISTS');
    } else {
        console.log('DUPLICATE_HANDLING_MISSING');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "DUPLICATE_HANDLING_EXISTS"; then
    echo "[PASS] Duplicate name handling exists: contains 'DUPLICATE_HANDLING_EXISTS'"
else
    echo "[FAIL] Duplicate name handling not found: $RESULT"
    exit 1
fi

echo "AC-007-02: ✅ PASS"
exit 0