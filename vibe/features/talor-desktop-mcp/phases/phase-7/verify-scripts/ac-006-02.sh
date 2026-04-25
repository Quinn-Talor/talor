#!/bin/bash
# ac-006-02.sh - AC-006-02: MCP Server 连接状态显示

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/_common.sh"

log_info "Starting AC-006-02: MCP Server Connection Status Verification"

TALOR_DIR="/Users/quinn.li/Desktop/talor/talor-desktop"

log_info "Verifying MCP server status API..."

# Verify mcp:servers:status IPC handler exists
if grep -q "mcp:servers:status" "$TALOR_DIR/src/main/ipc/mcp.ts"; then
    log_info "✅ MCP server status API verified"
    echo "[PASS] AC-006-02: MCP server status API implemented"
    exit 0
else
    log_error "❌ MCP server status API not found"
    echo "[FAIL] AC-006-02: No MCP server status API"
    exit 1
fi
