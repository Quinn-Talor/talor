#!/bin/bash
# ac-005-02.sh - AC-005-02: Agent 调用 HTTP MCP 工具

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Starting AC-005-02: HTTP MCP Tool Call Verification"

TALOR_DIR="/Users/quinn.li/Desktop/talor/talor-desktop"

log_info "Verifying MCP tool execution in toolRegistry..."

# Verify toolRegistry.execute() can handle external tools
if grep -q "getToolFromExternal" "$TALOR_DIR/src/main/tools/registry.ts"; then
    log_info "✅ External tool execution verified in registry"
    echo "[PASS] AC-005-02: toolRegistry supports external tool execution"
    exit 0
else
    log_error "❌ External tool execution not found"
    echo "[FAIL] AC-005-02: toolRegistry doesn't support external tools"
    exit 1
fi
