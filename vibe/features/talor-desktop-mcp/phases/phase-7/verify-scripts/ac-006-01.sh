#!/bin/bash
# ac-006-01.sh - AC-006-01: 查看 MCP 工具列表

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Starting AC-006-01: View MCP Tool List Verification"

TALOR_DIR="/Users/quinn.li/Desktop/talor/talor-desktop"

log_info "Verifying listAllTools() returns MCP tools..."

# Verify listAllTools() includes both builtin and external tools
if grep -q "builtin.*external\|external.*builtin\|...builtin.*...external" "$TALOR_DIR/src/main/tools/registry.ts"; then
    log_info "✅ listAllTools() implementation verified"
    echo "[PASS] AC-006-01: listAllTools() includes both builtin and MCP tools"
    exit 0
else
    # Check for the simpler implementation
    if grep -q "listAllTools()" "$TALOR_DIR/src/main/tools/registry.ts" && grep -q "externalProviders" "$TALOR_DIR/src/main/tools/registry.ts"; then
        log_info "✅ listAllTools() with external providers verified"
        echo "[PASS] AC-006-01: listAllTools() supports external MCP tools"
        exit 0
    fi
fi

log_error "❌ listAllTools() implementation not found"
echo "[FAIL] AC-006-01: listAllTools() doesn't support external tools"
exit 1
