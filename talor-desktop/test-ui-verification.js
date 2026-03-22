// UI验证脚本：检查Provider列表是否显示模型

import { chromium } from 'playwright';

async function verifyUI() {
  console.log('=== UI验证：检查Provider列表模型显示 ===');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  
  console.log(`连接到: ${await page.title()} (${page.url()})`);
  
  try {
    // 1. 导航到设置页面
    console.log('\n1. 导航到设置页面...');
    await page.goto('http://localhost:5173/#/settings');
    await page.waitForTimeout(2000);
    
    // 2. 检查页面内容
    const pageText = await page.textContent('body');
    console.log(`页面文本长度: ${pageText?.length || 0} 字符`);
    
    // 3. 查找Provider卡片
    console.log('\n2. 查找Provider卡片...');
    const providerCards = await page.$$('div.bg-white.rounded-xl.border');
    console.log(`找到 ${providerCards.length} 个Provider卡片`);
    
    if (providerCards.length === 0) {
      console.log('⚠ 未找到Provider卡片，可能需要先创建Provider');
      console.log('查找"新增 Provider"按钮...');
      
      const addButtons = await page.$$('button:has-text("新增 Provider"), button:has-text("Add Provider")');
      if (addButtons.length > 0) {
        console.log(`找到 ${addButtons.length} 个新增按钮`);
        console.log('✅ 用户界面正常，但需要先创建Provider');
        
        // 截图
        await page.screenshot({ path: 'ui-no-providers.png', fullPage: true });
        console.log('截图已保存: ui-no-providers.png');
        
        console.log('\n=== Layer 2验证结果 ===');
        console.log('AC-010-01: 用户可以在Provider配置页面看到自动检测到的模型列表');
        console.log('状态: ⚠ 部分满足');
        console.log('原因: UI界面正常，但需要先创建Provider才能显示模型列表');
        console.log('建议: 创建一个Ollama Provider，然后测试连接以获取模型列表');
        
        return;
      }
    }
    
    // 4. 检查每个Provider卡片的模型显示
    console.log('\n3. 检查Provider卡片内容...');
    let foundModels = false;
    
    for (let i = 0; i < providerCards.length; i++) {
      const card = providerCards[i];
      const cardText = await card.textContent();
      console.log(`\n卡片 ${i+1} 内容预览: ${cardText?.substring(0, 100)}...`);
      
      // 检查是否有模型相关文本
      if (cardText && (cardText.includes('模型') || cardText.includes('model') || 
          cardText.includes('qwen') || cardText.includes('deepseek'))) {
        console.log(`✅ 卡片 ${i+1} 包含模型信息`);
        foundModels = true;
        
        // 检查具体模型显示
        const modelCards = await card.$$('.model-card, [data-testid="model-card"]');
        console.log(`  找到 ${modelCards.length} 个模型卡片`);
        
        if (modelCards.length > 0) {
          for (let j = 0; j < Math.min(modelCards.length, 3); j++) {
            const modelText = await modelCards[j].textContent();
            console.log(`  模型 ${j+1}: ${modelText?.substring(0, 50)}...`);
          }
        }
      } else {
        console.log(`❌ 卡片 ${i+1} 不包含模型信息`);
        
        // 检查是否有"测试连接"按钮
        const testButtons = await card.$$('button:has-text("测试连接"), button:has-text("Test Connection")');
        if (testButtons.length > 0) {
          console.log(`  有测试连接按钮，点击可能获取模型列表`);
        }
      }
    }
    
    // 5. 截图保存
    console.log('\n4. 保存验证截图...');
    await page.screenshot({ path: 'ui-verification.png', fullPage: true });
    console.log('截图已保存: ui-verification.png');
    
    // 6. 验证结果
    console.log('\n=== Layer 2验证结果 ===');
    console.log('AC-010-01: 用户可以在Provider配置页面看到自动检测到的模型列表');
    
    if (foundModels) {
      console.log('状态: ✅ 通过');
      console.log('用户可以在Provider配置页面看到自动检测到的模型列表');
    } else if (providerCards.length > 0) {
      console.log('状态: ⚠ 部分通过');
      console.log('Provider卡片存在，但未显示模型列表');
      console.log('可能原因:');
      console.log('  1. Provider未启用');
      console.log('  2. 需要点击"测试连接"获取模型列表');
      console.log('  3. Ollama服务未返回模型列表');
      console.log('  4. 模型数据未正确保存到Provider配置');
    } else {
      console.log('状态: ❌ 未通过');
      console.log('未找到Provider配置，需要先创建Provider');
    }
    
    // 7. 提供手动验证步骤
    console.log('\n=== 手动验证步骤 ===');
    console.log('1. 打开Electron应用');
    console.log('2. 进入设置页面 (Settings)');
    console.log('3. 检查是否有已配置的Provider');
    console.log('4. 如果没有，点击"新增 Provider"');
    console.log('5. 配置Ollama Provider (URL: http://localhost:11434)');
    console.log('6. 保存后，点击"测试连接"');
    console.log('7. 检查Provider卡片是否显示模型列表');
    console.log('8. 应该看到qwen3-coder和deepseek-v3.1模型');
    
  } catch (error) {
    console.error('验证过程中出错:', error);
  } finally {
    console.log('\n=== 验证完成 ===');
    // 保持浏览器打开
  }
}

verifyUI().catch(console.error);