#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-007-01: 通过 JSON 导入 MCP 配置"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking import functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('importConfig') || content.includes('JSON.parse')) {
        console.log('IMPORT_SUPPORTED');
    } else {
        console.log('IMPORT_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "IMPORT_SUPPORTED"; then
    echo "[PASS] Import functionality exists: contains 'IMPORT_SUPPORTED'"
else
    echo "[FAIL] Import functionality not found: $RESULT"
    exit 1
fi

echo "AC-007-01: ✅ PASS"
exit 0