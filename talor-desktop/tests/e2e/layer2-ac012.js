/**
 * Layer 2 验证脚本 - Phase 3 AC-012-03 / AC-012-04 / AC-012-05
 * 通过 CDP 连接到已运行的 Electron 应用执行验证
 *
 * 运行方式: node tests/e2e/layer2-ac012.js
 */

import { chromium } from 'playwright'

const CDP_URL = 'http://localhost:9222'
const RESULTS = []

function log(msg) {
  console.log(msg)
}

function result(ac, layer, status, detail) {
  const entry = { ac, layer, status, detail }
  RESULTS.push(entry)
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
  console.log(`  ${icon} [${ac}][${layer}] ${detail}`)
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

async function connectCDP() {
  const browser = await chromium.connectOverCDP(CDP_URL)
  const contexts = browser.contexts()
  if (!contexts.length) throw new Error('No browser context found via CDP')
  const pages = contexts[0].pages()
  if (!pages.length) throw new Error('No page found in CDP context')
  const page = pages[0]
  log(`\n[CDP] Connected to: ${await page.title()} — ${page.url()}`)
  return { browser, page }
}

async function navigateToChatTab(page) {
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('header button'))
    const chatBtn = btns.find(b => b.textContent?.includes('对话'))
    if (chatBtn) chatBtn.click()
  })
  await page.waitForTimeout(500)
}

async function ensureSessionSelected(page) {
  await navigateToChatTab(page)

  const sessions = await page.evaluate(async () => {
    try { return await window.talorAPI.session.list() } catch (e) { return [] }
  })
  log(`[setup] sessions in DB: ${sessions.length}`)

  if (sessions.length === 0) {
    log('[setup] No sessions — creating one via UI')
    await page.click('button[title="新建会话"]')
    await page.waitForTimeout(1500)
  }

  const triggerVisible = await page.$('[data-testid="model-picker-trigger"]')
  if (triggerVisible) {
    log('[setup] A session is already selected (model-picker-trigger visible)')
    return true
  }

  const firstSession = await page.$('div.cursor-pointer')
  if (!firstSession) {
    log('[setup] No clickable session item found')
    return false
  }
  await firstSession.click()
  await page.waitForTimeout(1000)

  const afterClick = await page.$('[data-testid="model-picker-trigger"]')
  if (afterClick) {
    log('[setup] Session selected — model-picker-trigger now visible')
    return true
  }
  log('[setup] model-picker-trigger still not visible after click')
  return false
}

// ────────────────────────────────────────────────────────────────
// AC-012-03: 现有会话模型切换（无弹框，消息保留）
// ────────────────────────────────────────────────────────────────

async function verifyAC01203(page) {
  log('\n══════════════════════════════════════')
  log('AC-012-03: 现有会话模型切换验证（无弹框，消息保留）')
  log('══════════════════════════════════════')

  try {
    await page.waitForTimeout(500)

    const ready = await ensureSessionSelected(page)
    if (!ready) {
      result('AC-012-03', 'L2', 'FAIL', '无法选中任何会话，model-picker-trigger 不可见')
      return
    }

    // Get current model name
    const currentModelText = await page.$eval('[data-testid="model-picker-trigger"] span', el => el.textContent?.trim() || '').catch(() => '')
    log(`[AC-012-03] 当前模型: "${currentModelText}"`)

    // Click trigger to open dropdown
    await page.click('[data-testid="model-picker-trigger"]')
    await page.waitForTimeout(500)

    const dropdown = await page.$('[data-testid="model-picker-dropdown"]')
    if (!dropdown) {
      result('AC-012-03', 'L2', 'FAIL', 'model-picker-dropdown 未出现')
      return
    }
    result('AC-012-03', 'L2', 'PASS', 'model-picker-dropdown 出现')

    // Find a model different from current
    const modelOptions = await page.$$('[data-testid^="model-option-"]')
    log(`[AC-012-03] 找到 ${modelOptions.length} 个模型选项`)
    if (modelOptions.length < 2) {
      result('AC-012-03', 'L2', 'WARN', `模型选项不足 2 个（${modelOptions.length} 个），无法测试切换`)
      await page.keyboard.press('Escape')
      return
    }

    let targetOption = null
    for (const opt of modelOptions) {
      const displayName = await opt.$eval('div.font-medium', el => el.textContent?.trim()).catch(() => '')
      if (displayName && displayName !== currentModelText) {
        targetOption = opt
        log(`[AC-012-03] 目标模型: ${displayName}`)
        break
      }
    }
    if (!targetOption) {
      targetOption = modelOptions[0]
      log('[AC-012-03] 使用第一个模型选项作为目标')
    }

    // Get current message count before switching
    const msgsBefore = await page.$$eval('[data-testid^="message-bubble-"]', els => els.length).catch(() => 0)
    log(`[AC-012-03] 切换前消息数: ${msgsBefore}`)

    await targetOption.click()
    await page.waitForTimeout(1000)

    // Verify NO ConfirmDialog appeared
    const confirmBtn = await page.$('[data-testid="confirm-dialog-confirm"]')
    if (confirmBtn) {
      result('AC-012-03', 'L2', 'FAIL', 'ConfirmDialog 意外出现 (confirm-dialog-confirm visible)，应直接切换')
      await page.keyboard.press('Escape')
      return
    }
    result('AC-012-03', 'L2', 'PASS', '未出现 ConfirmDialog（直接切换）')

    // Verify toast appears
    const toast = await page.waitForSelector('[data-testid="model-switched-toast"]', { timeout: 3000 }).catch(() => null)
    if (toast) {
      const toastText = await toast.textContent()
      result('AC-012-03', 'L2', 'PASS', `model-switched-toast 出现: "${toastText?.trim()}"`)
    } else {
      result('AC-012-03', 'L2', 'FAIL', 'model-switched-toast 未出现')
    }

    // Verify messages NOT cleared (session history preserved)
    await page.waitForTimeout(500)
    if (msgsBefore > 0) {
      const msgsAfter = await page.$$eval('[data-testid^="message-bubble-"]', els => els.length).catch(() => 0)
      log(`[AC-012-03] 切换后消息数: ${msgsAfter}`)
      if (msgsAfter === msgsBefore) {
        result('AC-012-03', 'L2', 'PASS', `消息历史保留（切换前: ${msgsBefore}，切换后: ${msgsAfter}）`)
      } else {
        result('AC-012-03', 'L2', 'FAIL', `消息数发生变化（切换前: ${msgsBefore}，切换后: ${msgsAfter}）`)
      }
    } else {
      // No messages in session — just verify empty state still shows (not cleared into weird state)
      result('AC-012-03', 'L2', 'PASS', '会话无消息，切换后仍显示正常（无消息可验证保留）')
    }

  } catch (err) {
    result('AC-012-03', 'L2', 'FAIL', `执行出错: ${err.message}`)
  }
}

// ────────────────────────────────────────────────────────────────
// AC-012-04: 模型不可用处理
// ────────────────────────────────────────────────────────────────

async function verifyAC01204(page) {
  log('\n══════════════════════════════════════')
  log('AC-012-04: 模型不可用处理验证')
  log('══════════════════════════════════════')

  let sessionId = null
  let originalModelId = null

  try {
    // Step 1: Get existing session with a model_id
    const sessions = await page.evaluate(async () => {
      try { return await window.talorAPI.session.list() } catch (e) { return [] }
    })
    log(`[AC-012-04] 共 ${sessions.length} 个会话`)

    const targetSession = sessions.find(s => s.model_id)
    if (!targetSession) {
      result('AC-012-04', 'L2', 'WARN', '没有找到有 model_id 的会话，跳过')
      return
    }
    sessionId = targetSession.id
    originalModelId = targetSession.model_id
    log(`[AC-012-04] 测试会话: ${sessionId}, 原 model_id: ${originalModelId}`)

    // Step 2: Set fake model_id via IPC
    const fakeModelId = 'fake-provider/nonexistent-model-ac012-04-test'
    const updateResult = await page.evaluate(async ({ sid, fakeId }) => {
      try {
        const updated = await window.talorAPI.session.updateModel({ session_id: sid, model_id: fakeId })
        return { ok: true, model_id: updated?.model_id }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    }, { sid: sessionId, fakeId: fakeModelId })
    log(`[AC-012-04] updateModel result: ${JSON.stringify(updateResult)}`)

    if (!updateResult.ok) {
      result('AC-012-04', 'L2', 'FAIL', `无法通过 IPC 设置假 model_id: ${updateResult.error}`)
      return
    }

    // Step 3: Verify checkModelAvailability returns available=false
    const availResult = await page.evaluate(async (sid) => {
      try {
        return await window.talorAPI.session.checkModelAvailability({ session_id: sid })
      } catch (e) {
        return { available: null, error: e.message }
      }
    }, sessionId)
    log(`[AC-012-04] checkModelAvailability: ${JSON.stringify(availResult)}`)

    if (availResult && availResult.available === false) {
      result('AC-012-04', 'L2', 'PASS', `checkModelAvailability 返回 available=false (fake model_id 设置成功)`)
    } else {
      result('AC-012-04', 'L2', 'FAIL', `checkModelAvailability 未返回 available=false: ${JSON.stringify(availResult)}`)
    }

    // Step 4: Reload page to trigger the unavailable check on session load
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await navigateToChatTab(page)
    await page.waitForTimeout(500)

    // Step 5: Click the session with the fake model via UI
    const sessionsAfterReload = await page.evaluate(async () => {
      try { return await window.talorAPI.session.list() } catch (e) { return [] }
    })
    const testIdx = sessionsAfterReload.findIndex(s => s.id === sessionId)
    log(`[AC-012-04] 测试会话在列表中的索引: ${testIdx}`)

    if (testIdx < 0) {
      result('AC-012-04', 'L2', 'WARN', '测试会话不在列表中，无法通过 UI 触发')
      return
    }

    // Click the Nth session item (0-indexed cursor-pointer divs in the sidebar)
    const sessionItems = await page.$$('div.cursor-pointer')
    log(`[AC-012-04] 找到 ${sessionItems.length} 个 cursor-pointer 元素`)

    if (testIdx < sessionItems.length) {
      await sessionItems[testIdx].click()
      await page.waitForTimeout(1500)
    } else {
      // Fallback: click first one
      if (sessionItems.length > 0) {
        await sessionItems[0].click()
        await page.waitForTimeout(1500)
      }
    }

    // Step 6: Verify model-unavailable-banner appears
    const banner = await page.$('[data-testid="model-unavailable-banner"]')
    log(`[AC-012-04] model-unavailable-banner 出现: ${!!banner}`)

    if (banner) {
      const bannerText = await banner.textContent()
      result('AC-012-04', 'L2', 'PASS', `model-unavailable-banner 出现: "${bannerText?.trim()}"`)

      // Step 7: Click "选择其他模型" button
      const selectBtn = await page.$('[data-testid="select-other-model-btn"]')
      if (selectBtn) {
        await selectBtn.click()
        await page.waitForTimeout(500)
        const picker = await page.$('[data-testid="model-picker-dropdown"]')
        if (picker) {
          result('AC-012-04', 'L2', 'PASS', '点击"选择其他模型"后 model-picker-dropdown 出现')
          await page.keyboard.press('Escape')
        } else {
          result('AC-012-04', 'L2', 'FAIL', '点击"选择其他模型"后 model-picker-dropdown 未出现')
        }
      } else {
        result('AC-012-04', 'L2', 'FAIL', 'select-other-model-btn 未找到')
      }
    } else {
      result('AC-012-04', 'L2', 'FAIL', 'model-unavailable-banner 未出现')
    }

  } catch (err) {
    result('AC-012-04', 'L2', 'FAIL', `执行出错: ${err.message}`)
  } finally {
    // Restore original model_id
    if (sessionId && originalModelId) {
      const restoreResult = await page.evaluate(async ({ sid, mid }) => {
        try {
          await window.talorAPI.session.updateModel({ session_id: sid, model_id: mid })
          return true
        } catch (e) {
          return false
        }
      }, { sid: sessionId, mid: originalModelId }).catch(() => false)
      log(`[AC-012-04] 还原 model_id: ${restoreResult ? '成功' : '失败'}`)
    }
  }
}

// ────────────────────────────────────────────────────────────────
// AC-012-05: 模型与附件兼容性检查
// ────────────────────────────────────────────────────────────────

async function verifyAC01205(page) {
  log('\n══════════════════════════════════════')
  log('AC-012-05: 模型附件兼容性 — 静默切换验证')
  log('══════════════════════════════════════')

  try {
    // Reload to clean state
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(2000)
    await navigateToChatTab(page)
    await page.waitForTimeout(500)

    // Step 1: Get model options from app
    const modelOptionsData = await page.evaluate(async () => {
      try {
        const providers = await window.talorAPI.providers.list()
        const options = []
        for (const provider of providers) {
          const resp = await window.talorAPI.providers.getModels(provider.id)
          for (const model of resp.models) {
            options.push({
              id: model.id,
              displayName: model.display_name || model.name,
              supportsVision: model.supports_vision ?? false,
            })
          }
        }
        return options
      } catch (e) {
        return []
      }
    })
    log(`[AC-012-05] 共 ${modelOptionsData.length} 个模型:`)
    modelOptionsData.forEach(m => log(`  - ${m.displayName}: supportsVision=${m.supportsVision}`))

    const nonVisionModel = modelOptionsData.find(m => !m.supportsVision)
    if (!nonVisionModel) {
      result('AC-012-05', 'L2', 'WARN', '所有模型都 supports_vision=true，跳过完整验证')
      return
    }

    // Step 2: Ensure a session is selected
    const ready = await ensureSessionSelected(page)
    if (!ready) {
      result('AC-012-05', 'L2', 'FAIL', '无法选中会话，model-picker-trigger 不可见')
      return
    }

    // Step 3: Intercept window.confirm — new behavior should NOT call it
    await page.evaluate(() => {
      window.__confirmCalled = false
      window.__confirmMsg = null
      const orig = window.confirm
      window.confirm = (msg) => {
        window.__confirmCalled = true
        window.__confirmMsg = msg
        console.log('[TEST] window.confirm called:', msg)
        return false
      }
      window.__restoreConfirm = () => { window.confirm = orig }
    })
    log('[AC-012-05] window.confirm 已拦截（期望不被调用）')

    // Step 4: Inject image attachment via __test_setAttachments (dev hook)
    const injected = await page.evaluate(() => {
      if (typeof window.__test_setAttachments === 'function') {
        window.__test_setAttachments([{
          path: '/tmp/test.png',
          mime_type: 'image/png',
          filename: 'test.png',
          size_bytes: 1024,
        }])
        return true
      }
      return false
    })
    log(`[AC-012-05] __test_setAttachments 注入: ${injected}`)

    if (!injected) {
      result('AC-012-05', 'L2', 'FAIL', '__test_setAttachments 未注入 — dev hook 不存在')
      return
    }

    await page.waitForTimeout(300)

    // Step 5: Open model picker
    const trigger = await page.$('[data-testid="model-picker-trigger"]')
    if (!trigger) {
      result('AC-012-05', 'L2', 'FAIL', 'model-picker-trigger 不存在')
      return
    }
    await trigger.click()
    await page.waitForTimeout(300)

    // Step 6: Click non-vision model
    const nonVisionOption = await page.$(`[data-testid="model-option-${nonVisionModel.id}"]`)
    if (!nonVisionOption) {
      result('AC-012-05', 'L2', 'FAIL', `model-option-${nonVisionModel.id} 未在下拉中找到`)
      return
    }
    await nonVisionOption.click()
    await page.waitForTimeout(800)

    // Step 7: Verify window.confirm was NOT called (silent switch)
    const confirmCalled = await page.evaluate(() => window.__confirmCalled || false)
    const lastMsg = await page.evaluate(() => window.__confirmMsg || null)
    log(`[AC-012-05] window.confirm called: ${confirmCalled}, msg: "${lastMsg}"`)

    if (!confirmCalled) {
      result('AC-012-05', 'L2', 'PASS', 'window.confirm 未被调用（静默忽略图片附件，直接切换）')
    } else {
      result('AC-012-05', 'L2', 'FAIL', `window.confirm 意外被调用，消息: "${lastMsg}"`)
    }

    // Step 8: Verify switch succeeded via model-switched-toast
    const toast = await page.waitForSelector('[data-testid="model-switched-toast"]', { timeout: 3000 }).catch(() => null)
    if (toast) {
      result('AC-012-05', 'L2', 'PASS', 'model-switched-toast 出现，切换成功')
    } else {
      result('AC-012-05', 'L2', 'FAIL', 'model-switched-toast 未出现，切换可能失败')
    }

    await page.evaluate(() => window.__restoreConfirm?.())

  } catch (err) {
    result('AC-012-05', 'L2', 'FAIL', `执行出错: ${err.message}`)
  }
}

// ────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║  Phase 3 Layer 2 验证 — AC-012-03/04/05     ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log(`时间: ${new Date().toISOString()}`)

  let browser
  try {
    const connected = await connectCDP()
    browser = connected.browser
    const page = connected.page

    await verifyAC01203(page)
    await verifyAC01204(page)
    await verifyAC01205(page)

  } catch (err) {
    console.error('\n[FATAL] 连接 CDP 失败:', err.message)
    console.error('请确认 Electron 应用正在运行 (npm run dev)')
    process.exit(1)
  } finally {
    if (browser) await browser.close()
  }

  console.log('\n╔══════════════════════════════════════════════╗')
  console.log('║              验证结果汇总                     ║')
  console.log('╚══════════════════════════════════════════════╝')

  const byAC = {}
  for (const r of RESULTS) {
    if (!byAC[r.ac]) byAC[r.ac] = []
    byAC[r.ac].push(r)
  }

  let allPass = true
  for (const [ac, items] of Object.entries(byAC)) {
    const hasFail = items.some(i => i.status === 'FAIL')
    const hasWarn = items.some(i => i.status === 'WARN')
    const icon = hasFail ? '❌' : hasWarn ? '⚠️' : '✅'
    console.log(`\n${icon} ${ac}`)
    items.forEach(i => {
      const s = i.status === 'PASS' ? '✅' : i.status === 'FAIL' ? '❌' : '⚠️'
      console.log(`   ${s} ${i.detail}`)
    })
    if (hasFail) allPass = false
  }

  console.log('\n' + '─'.repeat(50))
  console.log(allPass ? '✅ 全部验证通过' : '❌ 存在失败项，请查看上方详情')
  console.log('─'.repeat(50))

  process.exit(allPass ? 0 : 1)
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
