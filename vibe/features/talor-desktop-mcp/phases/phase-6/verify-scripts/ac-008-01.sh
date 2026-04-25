#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-008-01: MCP 页面空状态"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking empty state UI code..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const listPath = path.join(__dirname, 'src/renderer/pages/Settings/MCPServerList.tsx');
if (fs.existsSync(listPath)) {
    const content = fs.readFileSync(listPath, 'utf8');
    const hasEmptyCheck = content.includes('length === 0') || content.includes('length==0');
    const hasEmptyDisplay = content.includes('暂无') || content.includes('No server') || content.includes('空状态');
    
    if (hasEmptyCheck && hasEmptyDisplay) {
        console.log('EMPTY_STATE_EXISTS');
    } else {
        console.log('EMPTY_STATE_MISSING');
    }
} else {
    console.log('LIST_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "EMPTY_STATE_EXISTS"; then
    echo "[PASS] Empty state UI exists: contains 'EMPTY_STATE_EXISTS'"
else
    echo "[FAIL] Empty state UI not found: $RESULT"
    exit 1
fi

echo "AC-008-01: ✅ PASS"
exit 0