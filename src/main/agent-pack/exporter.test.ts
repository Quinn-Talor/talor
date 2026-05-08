import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { exportAgentPack, PackExportError } from './exporter'
import type { AgentManager } from '../agent/agent-manager'
import type { AgentProfile } from '@shared/types/agent'
import type { Agent } from '../agent/agent'

let workspaceTmp: string
let outputDir: string

beforeEach(() => {
  workspaceTmp = mkdtempSync(join(tmpdir(), 'pack-test-ws-'))
  outputDir = mkdtempSync(join(tmpdir(), 'pack-test-out-'))
})

afterEach(() => {
  try {
    rmSync(workspaceTmp, { recursive: true, force: true })
    rmSync(outputDir, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

function makeAgentDir(parentDir: string, profile: AgentProfile): string {
  const dir = join(parentDir, profile.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(profile, null, 2), 'utf-8')
  return dir
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

const PROFILE_A: AgentProfile = {
  id: 'agent-a',
  name: 'Agent A',
  description: 'A',
  version: '1.0.0',
  role: { capabilities: ['cap-A'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
    subagents: [{ id: 'agent-b', required: true }],
  },
}

const PROFILE_B: AgentProfile = {
  id: 'agent-b',
  name: 'Agent B',
  description: 'B',
  version: '0.5.0',
  role: { capabilities: ['cap-B'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
    subagents: [{ id: 'agent-c', required: true }],
  },
}

const PROFILE_C: AgentProfile = {
  id: 'agent-c',
  name: 'Agent C',
  description: 'C',
  version: '0.3.0',
  role: { capabilities: ['cap-C'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
  },
}

describe('exportAgentPack (TASK-5, AC-032)', () => {
  it('AC-032: exports primary + recursive deps; manifest contains 3 entries', async () => {
    const dirA = makeAgentDir(workspaceTmp, PROFILE_A)
    const dirB = makeAgentDir(workspaceTmp, PROFILE_B)
    const dirC = makeAgentDir(workspaceTmp, PROFILE_C)

    const agents = new Map<string, Agent>([
      ['agent-a', makeMockAgent(PROFILE_A, dirA)],
      ['agent-b', makeMockAgent(PROFILE_B, dirB)],
      ['agent-c', makeMockAgent(PROFILE_C, dirC)],
    ])
    const manager = makeMockManager(agents)

    const { pack_path } = await exportAgentPack('agent-a', manager, outputDir)

    expect(existsSync(pack_path)).toBe(true)
    expect(pack_path).toContain('agent-a-1.0.0.talor-pack')
  })

  it('throws PackExportError on unresolved dependency', async () => {
    const dirA = makeAgentDir(workspaceTmp, PROFILE_A)
    // 不放 agent-b → unresolved
    const agents = new Map<string, Agent>([['agent-a', makeMockAgent(PROFILE_A, dirA)]])
    const manager = makeMockManager(agents)

    await expect(exportAgentPack('agent-a', manager, outputDir)).rejects.toThrow(PackExportError)
  })

  it('throws PackExportError when primary agent has no source', async () => {
    const profileNoSrc: AgentProfile = {
      ...PROFILE_A,
      dependencies: { ...PROFILE_A.dependencies, subagents: undefined },
    }
    const noSrcAgent = {
      id: profileNoSrc.id,
      name: profileNoSrc.name,
      profile: profileNoSrc,
      source: null,
    } as unknown as Agent
    const agents = new Map<string, Agent>([['agent-a', noSrcAgent]])
    const manager = makeMockManager(agents)

    await expect(exportAgentPack('agent-a', manager, outputDir)).rejects.toThrow(PackExportError)
  })

  it('handles circular dependency (A→B→A) without infinite loop', async () => {
    const profileACirc: AgentProfile = {
      ...PROFILE_A,
      dependencies: {
        ...PROFILE_A.dependencies,
        subagents: [{ id: 'agent-b', required: true }],
      },
    }
    const profileBCirc: AgentProfile = {
      ...PROFILE_B,
      dependencies: {
        ...PROFILE_B.dependencies,
        subagents: [{ id: 'agent-a', required: true }],
      },
    }
    const dirA = makeAgentDir(workspaceTmp, profileACirc)
    const dirB = makeAgentDir(workspaceTmp, profileBCirc)
    const agents = new Map<string, Agent>([
      ['agent-a', makeMockAgent(profileACirc, dirA)],
      ['agent-b', makeMockAgent(profileBCirc, dirB)],
    ])
    const manager = makeMockManager(agents)

    const { pack_path } = await exportAgentPack('agent-a', manager, outputDir)
    expect(existsSync(pack_path)).toBe(true)
  })
})
