const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  console.log('Opening talor-desktop...');
  await page.goto('http://localhost:5174');
  
  // Wait for app to load
  await page.waitForLoadState('networkidle');
  console.log('Page loaded');
  
  // Navigate to settings
  await page.goto('http://localhost:5174/#/settings');
  await page.waitForLoadState('networkidle');
  
  // Check for MCP Server tab
  const mcpTab = await page.$('text=MCP Server');
  if (mcpTab) {
    console.log('✅ MCP Server tab found');
    await mcpTab.click();
    
    // Wait for content
    await page.waitForTimeout(2000);
    
    const content = await page.content();
    if (content.includes('已连接') || content.includes('未连接')) {
      console.log('✅ MCP Server connection status visible');
    }
  } else {
    console.log('⚠️ MCP Server tab not found, checking Chat page...');
  }
  
  // Go to Chat
  await page.goto('http://localhost:5174/#/chat');
  await page.waitForLoadState('networkidle');
  
  // Create session if needed
  const newChatBtn = await page.$('[title="新建会话"]');
  if (newChatBtn) {
    console.log('Creating new session...');
    await newChatBtn.click();
    await page.waitForTimeout(1000);
  }
  
  // Check if we can send a message
  const textarea = await page.$('textarea');
  if (textarea) {
    console.log('✅ Chat input found');
    
    // Try sending a simple message
    await textarea.fill('test');
    const sendBtn = await page.$('button[title="发送"]');
    if (sendBtn) {
      console.log('✅ Send button found');
      
      // Clear and send actual test message
      await textarea.fill('hello');
      await sendBtn.click();
      
      console.log('Message sent, waiting for response...');
      await page.waitForTimeout(15000);
      
      const messages = await page.$$('[data-role="assistant"]');
      console.log(`✅ Received ${messages.length} assistant messages`);
    }
  }
  
  await browser.close();
  console.log('Verification complete');
})();
