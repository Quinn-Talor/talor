#!/bin/bash
set -e

# Phase 6 Layer 2 Verification Script
# talor-desktop MCP Server Configuration

echo "=== Phase 6 Layer 2 Verification ==="
echo "Project: talor-desktop"
echo "Phase: 6 - MCP Server Configuration"
echo ""

# Check if app is running
if ! pgrep -f "talor-desktop" > /dev/null 2>&1; then
  echo "ERROR: talor-desktop is not running"
  echo "Please start the app with: cd talor-desktop && npm run dev"
  exit 1
fi

# Helper function to check element exists
check_element() {
  local selector="$1"
  local expected="$2"
  # Using Playwright or manual verification
  echo "Checking: $selector should contain '$expected'"
}

echo "=== AC-001-01: Add STDIO MCP Server ==="
echo "Manual verification required:"
echo "1. Open Settings → MCP Server tab"
echo "2. Click '新增 Server'"
echo "3. Select type='stdio', name='文件系统', command='npx', args='-y @modelcontextprotocol/server-filesystem /tmp'"
echo "4. Click Save"
echo "5. Verify '文件系统（STDIO）' appears in list"
echo ""

echo "=== AC-001-02: Add HTTP MCP Server ==="
echo "Manual verification required:"
echo "1. Click '新增 Server'"
echo "2. Select type='http', name='GitHub API', url='https://mcp.example.com'"
echo "3. Click Save"
echo "4. Verify 'GitHub API（HTTP）' appears in list"
echo ""

echo "=== AC-001-03: Edit MCP Server ==="
echo "Manual verification required:"
echo "1. Click Edit on a server"
echo "2. Change name from '测试 Server' to '正式 Server'"
echo "3. Click Save"
echo "4. Verify name updated to '正式 Server'"
echo ""

echo "=== AC-002-01: STDIO Connection Test ==="
echo "Manual verification required:"
echo "1. Click '测试连接' on STDIO server"
echo "2. Verify success message with tool count"
echo ""

echo "=== AC-002-02: HTTP Connection Test ==="
echo "Manual verification required:"
echo "1. Click '测试连接' on HTTP server"
echo "2. Verify success message with tool count"
echo ""

echo "=== AC-002-03: Connection Timeout ==="
echo "Manual verification required:"
echo "1. Configure server with invalid URL"
echo "2. Click '测试连接'"
echo "3. Verify timeout error message"
echo ""

echo "=== AC-003-01: Disable Server ==="
echo "Manual verification required:"
echo "1. Click disable toggle on connected server"
echo "2. Verify '已禁用' status"
echo ""

echo "=== AC-003-02: Enable Server ==="
echo "Manual verification required:"
echo "1. Click enable toggle on disabled server"
echo "2. Verify '已连接' status"
echo ""

echo "=== AC-004-01: Delete Server ==="
echo "Manual verification required:"
echo "1. Click Delete on a server"
echo "2. Confirm in dialog"
echo "3. Verify server removed from list"
echo ""

echo "=== AC-007-01: Import JSON ==="
echo "Manual verification required:"
echo "1. Click '导入配置'"
echo "2. Paste MCP config JSON"
echo "3. Click Import"
echo "4. Verify servers created"
echo ""

echo "=== AC-007-02: Import Duplicate ==="
echo "Manual verification required:"
echo "1. Import config with existing server name"
echo "2. Verify '是否覆盖？' prompt"
echo ""

echo "=== AC-007-03: Import Error ==="
echo "Manual verification required:"
echo "1. Import invalid JSON"
echo "2. Verify error message"
echo ""

echo "=== AC-007-04: Export Config ==="
echo "Manual verification required:"
echo "1. Click '导出配置'"
echo "2. Verify valid JSON exported"
echo ""

echo "=== AC-008-01: Empty State ==="
echo "Manual verification required:"
echo "1. Delete all servers or fresh install"
echo "2. Open MCP Server page"
echo "3. Verify '暂无 MCP Server' message"
echo ""

echo "=== AC-008-02: Card Hover ==="
echo "Manual verification required:"
echo "1. Hover over server card"
echo "2. Verify shadow effect appears"
echo ""

echo "=== Verification Complete ==="
echo "Please complete manual checks and update impl.md §P.3"
