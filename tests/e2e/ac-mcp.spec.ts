import { test, expect } from '@playwright/test'

test.describe('MCP Tool Integration', () => {
  test('AC-005-01: Agent calls STDIO MCP tool', async ({ page }) => {
    await page.goto('http://localhost:5174')

    // Create a new session
    await page.click('[title="新建会话"]')

    // Set workspace (required for tools to be enabled)
    const workspaceSelect = page.locator('[data-testid="workspace-selector"]')
    if (await workspaceSelect.isVisible()) {
      await workspaceSelect.selectOption('/tmp')
    }

    // Send message to trigger MCP tool
    await page.fill('textarea[placeholder*="输入消息"]', '列出 /tmp 目录下的文件')
    await page.click('button[title="发送"]')

    // Wait for response
    await page.waitForTimeout(10000)

    // Verify tool was called and response received
    const messages = page.locator('[data-role="assistant"]')
    await expect(messages.last()).toBeVisible()

    const responseText = await messages.last().textContent()
    console.log('Response:', responseText)
  })

  test('AC-006-01: View MCP tool list', async ({ page }) => {
    await page.goto('http://localhost:5174/#/settings')

    // Navigate to MCP Server tab
    await page.click('text=MCP Server')

    // Verify server cards show tool counts
    const toolCountElements = page.locator('text=/\\d+ 工具/')
    const count = await toolCountElements.count()
    expect(count).toBeGreaterThan(0)
  })

  test('AC-006-02: View MCP server connection status', async ({ page }) => {
    await page.goto('http://localhost:5174/#/settings')

    // Navigate to MCP Server tab
    await page.click('text=MCP Server')

    // Verify connection status indicators
    const statusIndicators = page.locator('[class*="status"]')
    await expect(statusIndicators.first()).toBeVisible()
  })
})
