#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

TALOR_PATH=$(get_talor_desktop_path)

echo "========================================"
echo "AC-008-02: Server 卡片交互"
echo "========================================"

require_tools npm npx node || exit 1

cd "$TALOR_PATH"

echo "[Setup] Checking card hover effect..."
RESULT=$(node -e "
const fs = require('fs');
const path = require('path');
const listPath = path.join(__dirname, 'src/renderer/pages/Settings/MCPServerList.tsx');
if (fs.existsSync(listPath)) {
    const content = fs.readFileSync(listPath, 'utf8');
    if (content.includes('hover') || content.includes('transition') || content.includes('shadow')) {
        console.log('HOVER_EFFECT_EXISTS');
    } else {
        console.log('HOVER_EFFECT_MISSING');
    }
} else {
    console.log('LIST_NOT_FOUND');
}
" 2>&1) || true

if echo "$RESULT" | grep -q "HOVER_EFFECT_EXISTS"; then
    echo "[PASS] Card hover effect exists: contains 'HOVER_EFFECT_EXISTS'"
else
    echo "[FAIL] Card hover effect not found: $RESULT"
    exit 1
fi

echo "AC-008-02: ✅ PASS"
exit 0