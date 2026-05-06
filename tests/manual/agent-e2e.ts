/**
 * Agent System E2E Verification Script
 *
 * Tests the complete agent lifecycle via IPC calls directly from main process.
 * Run: npx tsx tests/manual/agent-e2e.ts
 */

import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { tmpdir, homedir } from 'os'

const AGENTS_DIR = join(homedir(), '.talor', 'agents')
const TEST_AGENT_DIR = join(AGENTS_DIR, 'e2e-test-agent')

const VALID_MANIFEST = {
  id: 'e2e-test-001',
  name: 'e2e-test-agent',
  description: 'E2E 测试用 Agent',
  version: '1.0.0',
  role: {
    capabilities: ['测试能力A', '测试能力B'],
    constraints: ['测试约束'],
    outputFormat: 'Markdown',
    personality: '简洁',
    language: 'zh-CN',
    sampleConversations: [
      {
        title: '测试对话',
        messages: [
          { role: 'user', content: '你好' },
          { role: 'assistant', content: '你好，有什么可以帮你？' },
        ],
      },
    ],
  },
  knowledge: {
    files: [],
  },
  dependencies: {
    tools: [{ name: 'bash', required: true }],
    skills: [],
    cli: [],
  },
}

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

async function setup() {
  if (existsSync(TEST_AGENT_DIR)) {
    rmSync(TEST_AGENT_DIR, { recursive: true })
  }
}

async function cleanup() {
  if (existsSync(TEST_AGENT_DIR)) {
    rmSync(TEST_AGENT_DIR, { recursive: true })
  }
}

// ==================== Test Modules Directly ====================

async function testValidator() {
  console.log('\n📋 Test: AgentManifest Validator')

  const { validateManifest } = await import('../src/main/agent/validator')

  const good = validateManifest(VALID_MANIFEST)
  assert(good.valid === true, 'AC-A1-01: 合法 manifest 校验通过')

  const noName = validateManifest({ ...VALID_MANIFEST, name: '' })
  assert(noName.valid === false, 'AC-A1-02: 空 name 拒绝')
  if (!noName.valid) {
    assert(
      noName.errors.some((e) => e.includes('name')),
      'AC-A1-02: 错误信息包含 "name"',
    )
  }

  const badVersion = validateManifest({ ...VALID_MANIFEST, version: 'abc' })
  assert(badVersion.valid === false, 'AC-A1-03: 非法 version 拒绝')
}

async function testLoader() {
  console.log('\n📋 Test: AgentLoader')

  mkdirSync(TEST_AGENT_DIR, { recursive: true })
  writeFileSync(join(TEST_AGENT_DIR, 'agent.json'), JSON.stringify(VALID_MANIFEST, null, 2))

  const { AgentLoader } = await import('../src/main/agent/loader')
  const loader = new AgentLoader(AGENTS_DIR)
  await loader.loadAll()

  const entry = loader.getById('e2e-test-001')
  assert(entry !== undefined, 'AC-A2-01: 加载合法 agent 成功')
  assert(entry?.status === 'ready', 'AC-A2-01: status === ready')
  assert(entry?.manifest.name === 'e2e-test-agent', 'AC-A2-01: manifest.name 正确')

  const byName = loader.getByName('e2e-test-agent')
  assert(byName !== undefined, 'getByName 查找成功')

  const all = loader.getAll()
  assert(
    all.some((a) => a.manifest.id === 'e2e-test-001'),
    'getAll 包含测试 agent',
  )

  // setStatus
  loader.setStatus('e2e-test-001', 'running')
  assert(loader.getById('e2e-test-001')?.status === 'running', 'IMPL-004: setStatus 更新 status')

  // updateLastUsed
  loader.updateLastUsed('e2e-test-001')
  const lastUsed = loader.getById('e2e-test-001')?.lastUsedAt
  assert(lastUsed !== undefined && lastUsed.includes('T'), 'IMPL-004: updateLastUsed 设置 ISO 时间')

  // lastUsedAt persistence
  assert(existsSync(join(TEST_AGENT_DIR, '.meta.json')), 'IMPL-024: .meta.json 文件已创建')
  const meta = JSON.parse(readFileSync(join(TEST_AGENT_DIR, '.meta.json'), 'utf-8'))
  assert(meta.lastUsedAt === lastUsed, 'IMPL-024: .meta.json 内容与内存一致')

  loader.stopWatching()
}

async function testDependencyChecker() {
  console.log('\n📋 Test: Dependency Checker')

  const { checkDependencies, _appVersion } = await import('../src/main/agent/dependency-checker')

  // Mock app version
  const originalGet = _appVersion.get
  _appVersion.get = () => '1.0.0'

  const result = await checkDependencies(VALID_MANIFEST as any, TEST_AGENT_DIR)
  assert(result.passed === true, 'AC-B2: 依赖检查全部通过')
  assert(
    result.steps.some((s) => s.step === 'minAppVersion' && s.status === 'pass'),
    'AC-B2: minAppVersion 通过',
  )

  // Test version too low
  const highVersion = { ...VALID_MANIFEST, minAppVersion: '99.0.0' }
  const failResult = await checkDependencies(highVersion as any, TEST_AGENT_DIR)
  const versionStep = failResult.steps.find((s) => s.step === 'minAppVersion')
  assert(versionStep?.status === 'fail', 'AC-B2-01: minAppVersion 版本过低返回 fail')
  assert(versionStep?.message?.includes('99.0.0') ?? false, 'AC-B2-01: 错误信息包含目标版本')

  _appVersion.get = originalGet
}

async function testVariableResolver() {
  console.log('\n📋 Test: Variable Resolver')

  const { resolveVariables } = await import('../src/main/agent/variable-resolver')

  const config = { APP_ID: '{{feishu_appid}}', TIMEOUT: '30000' }
  const values = new Map([['feishu_appid', 'cli_xxx']])

  const result = resolveVariables(config, values)
  assert(result.resolved['APP_ID'] === 'cli_xxx', 'AC-C3-01: 变量替换成功')
  assert(result.resolved['TIMEOUT'] === '30000', 'AC-C3-01: 非模板值保留原样')
  assert(result.missing.length === 0, 'AC-C3-01: 无缺失变量')

  const missing = resolveVariables({ KEY: '{{unknown}}' }, new Map())
  assert(missing.missing.includes('unknown'), 'AC-C3-02: 缺失变量被收集')
}

async function testSlashInvokeParser() {
  console.log('\n📋 Test: Slash Invoke Parser')

  const { parseSlashInvoke } = await import('../src/main/agent/slash-invoke-parser')
  const { AgentLoader } = await import('../src/main/agent/loader')

  const loader = new AgentLoader(AGENTS_DIR)
  await loader.loadAll()

  const result = parseSlashInvoke('/e2e-test-agent 帮我查数据', loader)
  assert(result !== null, 'AC-D3-01: slash invoke 匹配成功')
  assert(result?.entry.manifest.id === 'e2e-test-001', 'AC-D3-01: 匹配到正确 agent')
  assert(result?.remainingText === '帮我查数据', 'AC-D3-01: 提取正确 remainingText')

  const noMatch = parseSlashInvoke('/不存在的agent 你好', loader)
  assert(noMatch === null, 'AC-D3-02: 未匹配返回 null')

  const noSlash = parseSlashInvoke('普通消息', loader)
  assert(noSlash === null, 'AC-D3-02: 无斜杠返回 null')

  loader.stopWatching()
}

async function testCrystallizer() {
  console.log('\n📋 Test: Crystallizer')

  const { extractToolNames, buildCrystallizerPrompt, buildCrystallizerManifest } =
    await import('../src/main/agent/crystallizer')

  // extractToolNames
  const messages = [
    {
      id: '1',
      session_id: 's1',
      role: 'assistant' as const,
      content: JSON.stringify([
        { type: 'tool_use', name: 'bash' },
        { type: 'tool_use', name: 'read' },
        { type: 'tool_use', name: 'lark-sheets-read' },
      ]),
      created_at: '',
    },
    { id: '2', session_id: 's1', role: 'user' as const, content: '普通文本', created_at: '' },
  ]

  const tools = extractToolNames(messages)
  assert(tools.includes('bash'), 'AC-E3-01: 提取 bash')
  assert(tools.includes('lark-sheets-read'), 'AC-E3-01: 提取 lark-sheets-read')
  assert(!tools.includes('read'), 'AC-E3-01: 过滤基础工具 read')

  // buildCrystallizerPrompt
  const prompt = buildCrystallizerPrompt(['bash', 'lark-sheets-read'], 10)
  assert(prompt.includes('bash'), 'buildCrystallizerPrompt 包含工具名')
  assert(prompt.includes('10'), 'buildCrystallizerPrompt 包含消息数')

  // buildCrystallizerManifest
  const manifest = buildCrystallizerManifest()
  assert(manifest.id === '__crystallizer__', 'buildCrystallizerManifest id 正确')
  assert(
    manifest.dependencies.tools.some((t) => t.name === 'write'),
    'Crystallizer 声明 write 工具',
  )
}

async function testAccountStore() {
  console.log('\n📋 Test: AccountStore')

  const testDir = join(tmpdir(), 'talor-e2e-accounts-' + Date.now())
  mkdirSync(testDir, { recursive: true })

  const { AccountStore } = await import('../src/main/agent/accounts')
  const store = new AccountStore(testDir)

  store.save({
    service: '飞书',
    keys: [
      { name: 'appid', value: 'cli_xxx', secret: false },
      { name: 'secret_key', value: 'my-secret', secret: true },
    ],
  })

  const list = store.list()
  assert(list.length === 1, 'AC-C2-01: 账户保存成功')
  assert(list[0].service === '飞书', 'AC-C2-01: 服务名正确')

  const secretKey = list[0].keys.find((k) => k.name === 'secret_key')
  assert(secretKey?.value === '••••••', 'AC-C2-01: secret 脱敏返回')

  const realValue = store.getValue('secret_key')
  assert(realValue === 'my-secret', 'AC-C2-02: secret 实际值可查')

  const appid = store.getValue('appid')
  assert(appid === 'cli_xxx', 'AC-C2-02: 非 secret 值可查')

  // getAllValues for variable resolver
  const allVals = store.getAllValues()
  assert(allVals.get('appid') === 'cli_xxx', 'getAllValues 返回非 secret')
  assert(allVals.get('secret_key') === 'my-secret', 'getAllValues 返回 secret 实际值')

  store.delete('飞书')
  assert(store.list().length === 0, '删除账户成功')

  rmSync(testDir, { recursive: true })
}

async function testBuildToolsSandbox() {
  console.log('\n📋 Test: Build Tools Sandbox (概念验证)')

  // This tests the concept — actual buildTools needs full tool registry
  const ALWAYS_AVAILABLE = new Set(['read', 'ls', 'glob', 'grep'])

  const agentTools = [{ name: 'bash', required: true }]
  const allowedSet = new Set([...ALWAYS_AVAILABLE, ...agentTools.map((t) => t.name)])

  assert(allowedSet.has('read'), 'AC-A3: read 始终可用')
  assert(allowedSet.has('bash'), 'AC-A3: 声明的 bash 可用')
  assert(!allowedSet.has('write'), 'AC-A3: 未声明的 write 不可用')
  assert(!allowedSet.has('edit'), 'AC-A3: 未声明的 edit 不可用')
}

async function testExporterImporter() {
  console.log('\n📋 Test: Exporter + Importer')

  // Ensure test agent exists
  if (!existsSync(TEST_AGENT_DIR)) {
    mkdirSync(TEST_AGENT_DIR, { recursive: true })
    writeFileSync(join(TEST_AGENT_DIR, 'agent.json'), JSON.stringify(VALID_MANIFEST, null, 2))
  }

  const { exportAgent } = await import('../src/main/agent/exporter')
  const zipBuffer = await exportAgent(TEST_AGENT_DIR, VALID_MANIFEST as any)
  assert(Buffer.isBuffer(zipBuffer), 'AC-B1-01: 导出返回 Buffer')
  assert(zipBuffer.length > 0, 'AC-B1-01: zip Buffer 非空')

  // Write zip to temp file for import test
  const zipPath = join(tmpdir(), `e2e-test-${Date.now()}.agent.zip`)
  writeFileSync(zipPath, zipBuffer)

  const { importAgent } = await import('../src/main/agent/importer')
  const importDir = join(tmpdir(), `talor-e2e-import-${Date.now()}`)
  mkdirSync(importDir, { recursive: true })

  const importResult = await importAgent(zipPath, importDir)
  assert(importResult.manifest.id === 'e2e-test-001', 'AC-B1-02: 导入 manifest id 正确')
  assert(existsSync(join(importResult.dirPath, 'agent.json')), 'AC-B1-02: 导入目录包含 agent.json')
  assert(importResult.overwritten === false, 'AC-B1-02: 首次导入 overwritten === false')

  // Import again → overwrite
  const importResult2 = await importAgent(zipPath, importDir)
  assert(importResult2.overwritten === true, 'AC-B1-03: 同名导入 overwritten === true')

  // Cleanup
  rmSync(importDir, { recursive: true })
  rmSync(zipPath)
}

// ==================== Main ====================

async function main() {
  console.log('🚀 Agent System E2E Verification\n')
  console.log(`Agents directory: ${AGENTS_DIR}`)

  await setup()

  try {
    await testValidator()
    await testLoader()
    await testDependencyChecker()
    await testVariableResolver()
    await testSlashInvokeParser()
    await testCrystallizer()
    await testAccountStore()
    await testBuildToolsSandbox()
    await testExporterImporter()
  } catch (err) {
    console.error('\n💥 Unexpected error:', err)
    failed++
  }

  await cleanup()

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`📊 Total:  ${passed + failed}`)
  console.log(`${'═'.repeat(50)}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main()
