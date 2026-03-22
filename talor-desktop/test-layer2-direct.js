// 直接验证脚本：通过远程调试检查应用状态

async function checkAppState() {
  console.log('=== 直接验证：检查应用状态 ===');
  
  try {
    // 1. 检查Electron远程调试端口
    console.log('1. 检查Electron远程调试端口...');
    
    const debugInfo = await fetch('http://localhost:9222/json/list');
    const pages = await debugInfo.json();
    
    console.log(`✓ 远程调试端口可访问，找到 ${pages.length} 个页面`);
    console.log(`页面标题: ${pages[0]?.title || '未知'}`);
    console.log(`页面URL: ${pages[0]?.url || '未知'}`);
    
    // 2. 检查Ollama服务
    console.log('\n2. 检查Ollama服务...');
    try {
      const ollamaResponse = await fetch('http://localhost:11434/api/tags');
      const ollamaData = await ollamaResponse.json();
      console.log(`✓ Ollama服务运行正常`);
      console.log(`可用模型: ${ollamaData.models?.length || 0} 个`);
      if (ollamaData.models && ollamaData.models.length > 0) {
        ollamaData.models.forEach((model, i) => {
          console.log(`  ${i+1}. ${model.name} (${model.size ? Math.round(model.size/1e9) + 'GB' : '大小未知'})`);
        });
      }
    } catch (ollamaError) {
      console.log(`❌ Ollama服务不可访问: ${ollamaError.message}`);
    }
    
    // 3. 检查后端API
    console.log('\n3. 检查Provider模型获取API...');
    try {
      // 首先检查是否有已配置的Provider
      const configResponse = await fetch('http://localhost:8000/api/providers');
      const providers = await configResponse.json();
      console.log(`✓ 后端API可访问`);
      console.log(`已配置Provider: ${providers.length} 个`);
      
      if (providers.length > 0) {
        // 测试第一个Provider的模型获取
        const provider = providers[0];
        console.log(`测试Provider: ${provider.name} (${provider.type})`);
        
        try {
          const modelsResponse = await fetch(`http://localhost:8000/api/providers/${provider.id}/models`);
          const modelsData = await modelsResponse.json();
          console.log(`模型获取成功: ${modelsData.models?.length || 0} 个模型`);
        } catch (modelError) {
          console.log(`❌ 模型获取失败: ${modelError.message}`);
        }
      }
    } catch (apiError) {
      console.log(`❌ 后端API不可访问: ${apiError.message}`);
      console.log('提示：可能需要启动后端服务 (cd talor && uvicorn src.api.app:app --reload --port 8000)');
    }
    
    // 4. 验证AC-010-01 Layer 2状态
    console.log('\n=== AC-010-01 Layer 2验证状态 ===');
    console.log('基于当前检查，评估用户能否在Provider配置页面看到自动检测到的模型列表:');
    
    const checks = {
      electronRunning: pages.length > 0,
      ollamaAvailable: false, // 将在下面设置
      backendAvailable: false, // 将在下面设置
      modelsAvailable: false
    };
    
    // 重新检查Ollama可用性
    try {
      const ollamaCheck = await fetch('http://localhost:11434/api/tags');
      checks.ollamaAvailable = ollamaCheck.ok;
    } catch (e) {
      checks.ollamaAvailable = false;
    }
    
    // 重新检查后端可用性
    try {
      const backendCheck = await fetch('http://localhost:8000/api/providers');
      checks.backendAvailable = backendCheck.ok;
    } catch (e) {
      checks.backendAvailable = false;
    }
    
    console.log(`Electron应用运行: ${checks.electronRunning ? '✅' : '❌'}`);
    console.log(`Ollama服务可用: ${checks.ollamaAvailable ? '✅' : '❌'}`);
    console.log(`后端API可用: ${checks.backendAvailable ? '✅' : '❌'}`);
    
    // 综合评估
    if (checks.electronRunning && checks.ollamaAvailable) {
      console.log('\n🎉 基础条件满足，用户应该能看到模型列表');
      console.log('建议：手动打开Electron应用，进入设置页面检查Provider配置');
    } else {
      console.log('\n⚠ 基础条件不满足，需要修复：');
      if (!checks.electronRunning) console.log('  - Electron应用未运行或远程调试未启用');
      if (!checks.ollamaAvailable) console.log('  - Ollama服务未运行 (http://localhost:11434)');
      if (!checks.backendAvailable) console.log('  - 后端API未运行 (http://localhost:8000)');
    }
    
    // 5. 提供手动验证步骤
    console.log('\n=== 手动验证步骤 ===');
    console.log('1. 确保以下服务运行:');
    console.log('   - Electron应用 (talor-desktop)');
    console.log('   - Ollama (http://localhost:11434)');
    console.log('   - 后端API (可选，http://localhost:8000)');
    console.log('2. 打开Electron应用');
    console.log('3. 进入设置页面 (Settings)');
    console.log('4. 找到Provider配置部分');
    console.log('5. 查看Ollama Provider，应该显示检测到的模型列表');
    console.log('6. 如果未显示，检查:');
    console.log('   - Provider配置是否正确');
    console.log('   - 网络连接是否正常');
    console.log('   - 控制台是否有错误');
    
  } catch (error) {
    console.error('验证过程中出错:', error);
  }
}

// 运行检查
checkAppState().catch(console.error);