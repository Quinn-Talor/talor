#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-001-02: 添加 HTTP 模式 MCP Server"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking HTTP form fields..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const formPath = path.join(__dirname, 'src/renderer/pages/Settings/MCPServerForm.tsx');
if (fs.existsSync(formPath)) {
    const content = fs.readFileSync(formPath, 'utf8');
    if (content.includes('type') && content.includes('http') && content.includes('url')) {
        console.log('HTTP_FORM_VALID');
    } else {
        console.log('HTTP_FORM_INVALID');
    }
} else {
    console.log('FORM_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "HTTP_FORM_VALID"; then
    echo "[PASS] MCP Server Form supports HTTP type: contains 'HTTP_FORM_VALID'"
else
    echo "[FAIL] MCP Server Form missing HTTP fields: $RESULT"
    exit 1
fi

echo "AC-001-02: ✅ PASS"
exit 0