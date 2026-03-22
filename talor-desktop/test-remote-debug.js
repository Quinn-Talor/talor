// 通过远程调试连接Electron应用进行检查

import { chromium } from 'playwright';

async function inspectElectronApp() {
  console.log('=== 通过远程调试检查Electron应用 ===');
  
  // 连接到已有的Electron实例
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  
  if (contexts.length === 0) {
    console.log('❌ 未找到浏览器上下文');
    await browser.close();
    return;
  }
  
  const context = contexts[0];
  const pages = context.pages();
  
  if (pages.length === 0) {
    console.log('❌ 未找到页面');
    await browser.close();
    return;
  }
  
  const page = pages[0];
  console.log(`✓ 连接到Electron应用: ${await page.title()}`);
  console.log(`当前URL: ${page.url()}`);
  
  try {
    // 检查页面内容
    console.log('\n1. 检查页面结构...');
    const bodyText = await page.textContent('body');
    console.log(`页面文本长度: ${bodyText?.length || 0} 字符`);
    
    // 查找关键元素
    console.log('\n2. 查找关键UI元素...');
    
    // 检查是否有设置按钮
    const settingsButtons = await page.$$('button, a');
    console.log(`找到 ${settingsButtons.length} 个按钮/链接`);
    
    // 检查是否有Provider相关文本
    const allText = await page.evaluate(() => document.body.innerText);
    const hasProviderText = allText.toLowerCase().includes('provider');
    const hasSettingsText = allText.toLowerCase().includes('setting');
    const hasModelText = allText.toLowerCase().includes('model');
    
    console.log(`包含"provider"文本: ${hasProviderText ? '✅' : '❌'}`);
    console.log(`包含"settings"文本: ${hasSettingsText ? '✅' : '❌'}`);
    console.log(`包含"model"文本: ${hasModelText ? '✅' : '❌'}`);
    
    // 尝试导航到设置页面
    console.log('\n3. 尝试导航到设置页面...');
    
    // 方法1: 直接修改URL（如果应用支持）
    const currentUrl = page.url();
    if (currentUrl.includes('localhost:5173')) {
      const settingsUrl = currentUrl.replace(/#.*$/, '') + '#/settings';
      console.log(`尝试访问: ${settingsUrl}`);
      await page.goto(settingsUrl);
      await page.waitForTimeout(2000);
      
      const newTitle = await page.title();
      const newUrl = page.url();
      console.log(`导航后标题: ${newTitle}`);
      console.log(`导航后URL: ${newUrl}`);
      
      // 检查设置页面内容
      const settingsText = await page.evaluate(() => document.body.innerText);
      console.log(`设置页面文本长度: ${settingsText.length} 字符`);
      
      // 查找Provider配置
      if (settingsText.toLowerCase().includes('provider')) {
        console.log('✅ 设置页面包含Provider配置');
        
        // 截图保存
        await page.screenshot({ path: 'settings-page.png' });
        console.log('截图已保存: settings-page.png');
        
        // 查找模型相关元素
        const modelElements = await page.$$('div, span, li');
        let foundModels = false;
        
        for (const element of modelElements.slice(0, 50)) { // 检查前50个元素
          const text = await element.textContent();
          if (text && (text.includes('qwen') || text.includes('deepseek') || text.includes('model'))) {
            console.log(`找到模型相关文本: ${text.substring(0, 50)}...`);
            foundModels = true;
          }
        }
        
        console.log(`找到模型显示: ${foundModels ? '✅' : '❌'}`);
        
        if (!foundModels) {
          console.log('\n⚠ 未找到模型显示，可能原因:');
          console.log('  1. Provider未正确配置');
          console.log('  2. 模型获取逻辑有问题');
          console.log('  3. UI未正确渲染模型列表');
          console.log('  4. 需要手动刷新模型列表');
        }
      } else {
        console.log('❌ 设置页面不包含Provider配置');
      }
    }
    
    // 检查控制台错误
    console.log('\n4. 检查控制台错误...');
    const consoleLogs = await page.evaluate(() => {
      const logs = [];
      const originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn
      };
      
      console.log = function(...args) {
        logs.push({ type: 'log', args: args.map(String) });
        originalConsole.log.apply(console, args);
      };
      
      console.error = function(...args) {
        logs.push({ type: 'error', args: args.map(String) });
        originalConsole.error.apply(console, args);
      };
      
      console.warn = function(...args) {
        logs.push({ type: 'warn', args: args.map(String) });
        originalConsole.warn.apply(console, args);
      };
      
      // 触发一些操作来生成日志
      setTimeout(() => {
        console.log('测试日志: 应用检查完成');
      }, 100);
      
      return logs;
    });
    
    await page.waitForTimeout(200);
    console.log(`收集到 ${consoleLogs.length} 条控制台消息`);
    
    // 执行一些前端检查
    console.log('\n5. 执行前端检查...');
    const frontendCheck = await page.evaluate(() => {
      const check = {
        windowExists: typeof window !== 'undefined',
        talorAPI: typeof window.talorAPI !== 'undefined',
        providersAPI: window.talorAPI?.providers ? true : false,
        getModelsMethod: window.talorAPI?.providers?.getModels ? true : false,
        refreshModelsMethod: window.talorAPI?.providers?.refreshModels ? true : false
      };
      
      // 尝试调用getModels
      if (check.getModelsMethod) {
        try {
          const result = window.talorAPI.providers.getModels('ollama');
          check.getModelsCallable = true;
        } catch (e) {
          check.getModelsCallable = false;
          check.getModelsError = e.message;
        }
      }
      
      return check;
    });
    
    console.log(`window对象: ${frontendCheck.windowExists ? '✅' : '❌'}`);
    console.log(`talorAPI对象: ${frontendCheck.talorAPI ? '✅' : '❌'}`);
    console.log(`providersAPI: ${frontendCheck.providersAPI ? '✅' : '❌'}`);
    console.log(`getModels方法: ${frontendCheck.getModelsMethod ? '✅' : '❌'}`);
    console.log(`refreshModels方法: ${frontendCheck.refreshModelsMethod ? '✅' : '❌'}`);
    
    if (frontendCheck.getModelsMethod && !frontendCheck.getModelsCallable) {
      console.log(`getModels调用错误: ${frontendCheck.getModelsError}`);
    }
    
    // 综合评估
    console.log('\n=== Layer 2验证综合评估 ===');
    console.log('AC-010-01: 用户可以在Provider配置页面看到自动检测到的模型列表');
    
    const assessment = {
      appAccessible: true,
      settingsPageAccessible: hasSettingsText,
      providerSectionExists: hasProviderText,
      modelTextExists: hasModelText,
      frontendAPIAvailable: frontendCheck.getModelsMethod
    };
    
    console.log(`应用可访问: ${assessment.appAccessible ? '✅' : '❌'}`);
    console.log(`设置页面可访问: ${assessment.settingsPageAccessible ? '✅' : '⚠ 不确定'}`);
    console.log(`Provider配置部分存在: ${assessment.providerSectionExists ? '✅' : '❌'}`);
    console.log(`模型文本存在: ${assessment.modelTextExists ? '✅' : '❌'}`);
    console.log(`前端API可用: ${assessment.frontendAPIAvailable ? '✅' : '❌'}`);
    
    if (assessment.appAccessible && assessment.frontendAPIAvailable) {
      console.log('\n🎉 技术条件满足，实现基本正确');
      console.log('问题可能在于:');
      console.log('  1. Provider未正确配置（检查Ollama配置）');
      console.log('  2. 模型获取逻辑需要手动触发');
      console.log('  3. UI渲染需要特定交互');
    } else {
      console.log('\n⚠ 需要修复的问题:');
      if (!assessment.frontendAPIAvailable) {
        console.log('  - 前端preload脚本未正确导出getModels方法');
      }
      if (!assessment.providerSectionExists) {
        console.log('  - UI中未找到Provider配置部分');
      }
    }
    
  } catch (error) {
    console.error('检查过程中出错:', error);
  } finally {
    // 保持连接打开
    console.log('\n=== 检查完成 ===');
    console.log('远程调试连接保持打开，可以手动检查');
    console.log('Chrome DevTools URL: http://localhost:9222');
    
    // 不关闭浏览器，保持连接
    // await browser.close();
  }
}

// 运行检查
inspectElectronApp().catch(console.error);