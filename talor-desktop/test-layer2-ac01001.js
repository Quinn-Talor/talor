// Layer 2验证脚本：AC-010-01 - Provider模型列表自动检测
// 使用Playwright验证UI功能

import { chromium } from 'playwright';

async function testAC01001() {
  console.log('=== Layer 2验证：AC-010-01 - Provider模型列表自动检测 ===');
  console.log('目标：验证用户可以在Provider配置页面看到自动检测到的模型列表');
  
  const browser = await chromium.launch({
    headless: false, // 显示浏览器以便观察
    args: ['--remote-debugging-port=9223'] // 使用不同端口避免冲突
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // 1. 导航到talor-desktop应用
    console.log('1. 导航到talor-desktop应用...');
    await page.goto('http://localhost:5173');
    
    // 等待应用加载
    await page.waitForSelector('body', { timeout: 10000 });
    console.log('✓ 应用加载成功');
    
    // 2. 检查是否有设置/配置页面入口
    console.log('2. 寻找设置/配置页面入口...');
    
    // 尝试查找设置按钮或导航菜单
    const settingsSelectors = [
      'button:has-text("Settings")',
      'button:has-text("设置")',
      'a[href*="settings"]',
      'button svg[data-icon="settings"]',
      '[data-testid="settings-button"]'
    ];
    
    let settingsFound = false;
    for (const selector of settingsSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✓ 找到设置入口: ${selector}`);
          await element.click();
          settingsFound = true;
          break;
        }
      } catch (e) {
        // 继续尝试下一个选择器
      }
    }
    
    if (!settingsFound) {
      console.log('⚠ 未找到设置入口，尝试直接访问设置URL...');
      await page.goto('http://localhost:5173/settings');
    }
    
    // 等待设置页面加载
    await page.waitForTimeout(2000);
    
    // 3. 查找Provider配置部分
    console.log('3. 查找Provider配置部分...');
    
    const providerSelectors = [
      'h2:has-text("Providers")',
      'h2:has-text("提供者")',
      'div:has-text("Provider")',
      '[data-testid="providers-section"]'
    ];
    
    let providerSection = null;
    for (const selector of providerSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✓ 找到Provider配置部分: ${selector}`);
          providerSection = element;
          break;
        }
      } catch (e) {
        // 继续尝试
      }
    }
    
    if (!providerSection) {
      console.log('⚠ 未找到Provider配置部分，尝试查找表单...');
      // 尝试查找任何表单或输入框
      const forms = await page.$$('form, input, button');
      console.log(`找到 ${forms.length} 个表单元素`);
    }
    
    // 4. 检查是否有Ollama Provider
    console.log('4. 检查是否有Ollama Provider...');
    
    const ollamaSelectors = [
      'div:has-text("Ollama")',
      'button:has-text("Ollama")',
      'input[value*="ollama"]',
      '[data-provider="ollama"]'
    ];
    
    let ollamaFound = false;
    for (const selector of ollamaSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`✓ 找到Ollama Provider: ${selector}`);
          ollamaFound = true;
          
          // 尝试点击查看详情
          await element.click();
          await page.waitForTimeout(1000);
          break;
        }
      } catch (e) {
        // 继续尝试
      }
    }
    
    // 5. 检查模型列表显示
    console.log('5. 检查模型列表显示...');
    
    const modelSelectors = [
      'div:has-text("Models")',
      'div:has-text("模型")',
      '.model-card',
      '[data-testid="model-card"]',
      'div:has-text("qwen")',
      'div:has-text("deepseek")'
    ];
    
    let modelsFound = false;
    for (const selector of modelSelectors) {
      try {
        const elements = await page.$$(selector);
        if (elements.length > 0) {
          console.log(`✓ 找到模型相关元素 (${selector}): ${elements.length} 个`);
          modelsFound = true;
          
          // 输出找到的模型信息
          for (let i = 0; i < Math.min(elements.length, 3); i++) {
            const text = await elements[i].textContent();
            console.log(`  模型 ${i+1}: ${text?.substring(0, 50)}...`);
          }
          break;
        }
      } catch (e) {
        // 继续尝试
      }
    }
    
    // 6. 验证结果
    console.log('\n=== 验证结果 ===');
    console.log(`应用访问: ${true ? '✅' : '❌'}`);
    console.log(`设置页面: ${settingsFound ? '✅' : '⚠ 部分成功'}`);
    console.log(`Provider配置: ${providerSection ? '✅' : '⚠ 未明确找到'}`);
    console.log(`Ollama Provider: ${ollamaFound ? '✅' : '❌'}`);
    console.log(`模型列表显示: ${modelsFound ? '✅' : '❌'}`);
    
    if (ollamaFound && modelsFound) {
      console.log('\n🎉 AC-010-01 Layer 2验证通过！');
      console.log('用户可以在Provider配置页面看到自动检测到的模型列表。');
    } else {
      console.log('\n⚠ AC-010-01 Layer 2验证未通过。');
      console.log('可能的问题：');
      if (!ollamaFound) console.log('  - 未找到Ollama Provider配置');
      if (!modelsFound) console.log('  - 未显示模型列表');
      console.log('\n建议：');
      console.log('  1. 检查Ollama服务是否运行');
      console.log('  2. 检查Provider配置是否正确');
      console.log('  3. 检查前端模型获取逻辑');
    }
    
    // 截图保存证据
    console.log('\n7. 保存验证截图...');
    await page.screenshot({ path: 'layer2-ac01001-verification.png', fullPage: true });
    console.log('✓ 截图已保存: layer2-ac01001-verification.png');
    
  } catch (error) {
    console.error('验证过程中出错:', error);
    
    // 出错时也截图
    try {
      await page.screenshot({ path: 'layer2-ac01001-error.png', fullPage: true });
      console.log('错误截图已保存');
    } catch (e) {
      console.error('保存错误截图失败:', e);
    }
  } finally {
    // 保持浏览器打开以便手动检查
    console.log('\n=== 验证完成 ===');
    console.log('浏览器将保持打开状态，按Ctrl+C关闭。');
    console.log('手动检查URL: http://localhost:5173');
    
    // 注释掉关闭浏览器的代码，保持打开
    // await browser.close();
  }
}

// 运行测试
testAC01001().catch(console.error);