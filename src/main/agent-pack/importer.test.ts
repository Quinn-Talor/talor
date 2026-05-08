import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { exportAgentPack } from './exporter'
import { previewPack, commitPack, PackImportError } from './importer'
import type { AgentManager } from '../agent/agent-manager'
import type { AgentLoader } from '../agent/loader'
import type { AgentProfile } from '@shared/types/agent'
import type { Agent } from '../agent/agent'
import type { ImportConflict } from './manifest'

let workspaceTmp: string
let agentsDirRoot: string
let outputDir: string

beforeEach(() => {
  workspaceTmp = mkdtempSync(join(tmpdir(), 'pack-imp-ws-'))
  agentsDirRoot = mkdtempSync(join(tmpdir(), 'pack-imp-agents-'))
  outputDir = mkdtempSync(join(tmpdir(), 'pack-imp-out-'))
})

afterEach(() => {
  for (const dir of [workspaceTmp, agentsDirRoot, outputDir]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
})

function makeAgentDir(parentDir: string, profile: AgentProfile): string {
  const dir = join(parentDir, profile.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(profile, null, 2), 'utf-8')
  return dir
}

const PROFILE_PRIMARY: AgentProfile = {
  id: 'sales-trend-analyzer',
  name: 'Sales Trend Analyzer',
  description: '分析销售趋势',
  version: '1.0.0',
  role: { capabilities: ['analyze sales'], outputFormat: 'markdown' },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
    subagents: [{ id: 'sales-analyst-001', required: true }],
  },
}

const PROFILE_DEP: AgentProfile = {
  id: 'sales-analyst-001',
  name: 'Sales Analyst',
  description: '销售数据分析',
  version: '0.5.0',
  role: { capabilities: ['parse csv'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
  },
}

function makeMockAgent(profile: AgentProfile, dirPath: string): Agent {
  return {
    id: profile.id,
    name: profile.name,
    profile,
    source: dirPath,
  } as unknown as Agent
}

function makeMockManager(agents: Map<string, Agent>): AgentManager {
  return {
    getAgent: (id: string) => agents.get(id) ?? null,
    listBusinessAgentIds: () => Array.from(agents.keys()),
  } as unknown as AgentManager
}

function makeMockLoader(existingAgents: Map<string, AgentProfile>): AgentLoader {
  const internal = new Map(existingAgents)
  return {
    getById: (id: string) => {
      const profile = internal.get(id)
      if (!profile) return null
      return {
        profile,
        dirPath: '/fake',
        status: 'ready' as const,
        lastUsedAt: undefined,
      }
    },
    loadAll: () => {
      // 在 commit 测试里，重新扫描 agentsDirRoot 让测试能验证落盘
      // 这里简单不更新 internal map（测试用 fs.existsSync 验落盘）
    },
  } as unknown as AgentLoader
}

async function buildPackFile(): Promise<string> {
  const dirP = makeAgentDir(workspaceTmp, PROFILE_PRIMARY)
  const dirD = makeAgentDir(workspaceTmp, PROFILE_DEP)
  const agents = new Map<string, Agent>([
    ['sales-trend-analyzer', makeMockAgent(PROFILE_PRIMARY, dirP)],
    ['sales-analyst-001', makeMockAgent(PROFILE_DEP, dirD)],
  ])
  const manager = makeMockManager(agents)
  const { pack_path } = await exportAgentPack('sales-trend-analyzer', manager, outputDir)
  return pack_path
}

describe('previewPack (TASK-5, AC-033)', () => {
  it('AC-033: rejects malformed manifest', async () => {
    // 制造一个非 zip 文件
    const fakePath = join(outputDir, 'fake.talor-pack')
    writeFileSync(fakePath, 'not a zip', 'utf-8')

    const loader = makeMockLoader(new Map())
    await expect(previewPack(fakePath, loader)).rejects.toThrow(PackImportError)
  })

  it('preview returns agents + conflicts on a valid pack', async () => {
    const packPath = await buildPackFile()
    const loader = makeMockLoader(new Map())

    const preview = await previewPack(packPath, loader)
    expect(preview.agents.length).toBe(2)
    const primary = preview.agents.find((a) => a.kind === 'primary')!
    expect(primary.id).toBe('sales-trend-analyzer')

    // 全新（loader 不含），所有 conflict 应是 'replace'（即新增）
    expect(preview.conflicts).toHaveLength(2)
    for (const c of preview.conflicts) {
      expect(c.existing_version).toBeNull()
      expect(c.resolution).toBe('replace')
    }

    // 清理 staging（preview 内的 mkdtempSync 目录由调用者清理）
    rmSync(preview.staging_dir, { recursive: true, force: true })
  })
})

describe('commitPack (TASK-5, AC-034/035)', () => {
  it('AC-034: replace strategy backs up existing then writes new version', async () => {
    const packPath = await buildPackFile()

    // 现有 sales-analyst-001 v0.3.0（pack 含 v0.5.0 → replace）
    const existingDepDir = join(agentsDirRoot, 'sales-analyst-001')
    mkdirSync(existingDepDir, { recursive: true })
    writeFileSync(
      join(existingDepDir, 'agent.json'),
      JSON.stringify({ ...PROFILE_DEP, version: '0.3.0' }, null, 2),
    )

    const loader = makeMockLoader(
      new Map([['sales-analyst-001', { ...PROFILE_DEP, version: '0.3.0' }]]),
    )

    const preview = await previewPack(packPath, loader)
    const result = await commitPack(preview.staging_dir, preview.conflicts, agentsDirRoot, loader)

    expect(result.errors).toHaveLength(0)
    expect(result.imported).toContain('sales-analyst-001')
    expect(result.imported).toContain('sales-trend-analyzer')

    // 备份目录存在（agentsDirRoot/.backup/sales-analyst-001-<ts>/）
    const backupRoot = join(agentsDirRoot, '.backup')
    expect(existsSync(backupRoot)).toBe(true)

    // 新版本写入
    const newDep = JSON.parse(
      readFileSync(join(agentsDirRoot, 'sales-analyst-001/agent.json'), 'utf-8'),
    )
    expect(newDep.version).toBe('0.5.0')
  })

  it('AC-035: rename rewrites primary subagent reference', async () => {
    const packPath = await buildPackFile()
    const loader = makeMockLoader(new Map())

    const preview = await previewPack(packPath, loader)

    // 用户选择 rename dependency 'sales-analyst-001' 为 'sales-analyst-001-v2'
    const resolutions: ImportConflict[] = preview.conflicts.map((c) =>
      c.agent_id === 'sales-analyst-001'
        ? { ...c, resolution: 'rename', rename_to: 'sales-analyst-001-v2' }
        : c,
    )

    const result = await commitPack(preview.staging_dir, resolutions, agentsDirRoot, loader)

    expect(result.errors).toHaveLength(0)
    expect(result.imported).toContain('sales-analyst-001-v2')
    expect(result.imported).toContain('sales-trend-analyzer')

    // primary 的 subagents.id 引用应已 rewrite 为新 id
    const primaryProfile = JSON.parse(
      readFileSync(join(agentsDirRoot, 'sales-trend-analyzer/agent.json'), 'utf-8'),
    )
    expect(primaryProfile.dependencies.subagents).toEqual([
      { id: 'sales-analyst-001-v2', required: true },
    ])

    // 重命名后的 dep 落在新名字下
    expect(existsSync(join(agentsDirRoot, 'sales-analyst-001-v2/agent.json'))).toBe(true)
    // 旧名字下没有
    expect(existsSync(join(agentsDirRoot, 'sales-analyst-001'))).toBe(false)
  })

  it('skip resolution leaves existing untouched', async () => {
    const packPath = await buildPackFile()
    const loader = makeMockLoader(new Map())
    const preview = await previewPack(packPath, loader)

    // 全部改为 skip
    const resolutions: ImportConflict[] = preview.conflicts.map((c) => ({
      ...c,
      resolution: 'skip',
    }))

    const result = await commitPack(preview.staging_dir, resolutions, agentsDirRoot, loader)
    expect(result.imported).toHaveLength(0)
    expect(result.skipped.length).toBe(2)
  })
})
