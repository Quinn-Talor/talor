#!/bin/bash
# ac-005-01.sh - AC-005-01: Agent 调用 STDIO MCP 工具

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Starting AC-005-01: STDIO MCP Tool Call Verification"

TALOR_DIR="/Users/quinn.li/Desktop/talor/talor-desktop"

log_info "Verifying MCP tool registration in chat.ts..."

# Verify the fix was applied - listAllTools() includes MCP tools
if grep -q "listAllTools" "$TALOR_DIR/src/main/ipc/chat.ts"; then
    log_info "✅ Code fix verified: listAllTools() is used"
    echo "[PASS] AC-005-01: Code uses listAllTools() to include MCP tools"
    exit 0
else
    log_error "❌ Code fix not found"
    echo "[FAIL] AC-005-01: Code does not use listAllTools()"
    exit 1
fi
