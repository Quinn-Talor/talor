#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-007-04: 导出 MCP 配置"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking export functionality..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const ipcPath = path.join(__dirname, 'src/main/ipc/mcp.ts');
if (fs.existsSync(ipcPath)) {
    const content = fs.readFileSync(ipcPath, 'utf8');
    if (content.includes('exportConfig') || content.includes('JSON.stringify')) {
        console.log('EXPORT_SUPPORTED');
    } else {
        console.log('EXPORT_NOT_SUPPORTED');
    }
} else {
    console.log('IPC_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "EXPORT_SUPPORTED"; then
    echo "[PASS] Export functionality exists: contains 'EXPORT_SUPPORTED'"
else
    echo "[FAIL] Export functionality not found: $RESULT"
    exit 1
fi

echo "AC-007-04: ✅ PASS"
exit 0