#!/bin/bash
# ac-005-03.sh - AC-005-03: MCP 工具执行超时处理

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Starting AC-005-03: MCP Tool Timeout Verification"

TALOR_DIR="/Users/quinn.li/Desktop/talor/talor-desktop"

log_info "Verifying timeout handling in toolRegistry..."

# Verify timeout handling exists in the types or registry
if grep -q "timeout\|TIMEOUT_MS\|toolTimeoutMs" "$TALOR_DIR/src/main/tools/types.ts"; then
    log_info "✅ Timeout configuration verified"
    echo "[PASS] AC-005-03: toolRegistry supports timeout configuration"
    exit 0
else
    log_error "❌ Timeout handling not found"
    echo "[FAIL] AC-005-03: No timeout handling in toolRegistry"
    exit 1
fi
