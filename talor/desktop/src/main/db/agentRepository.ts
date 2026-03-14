import { getDatabase } from './database'
import type { Agent } from '../types'

const platformAgents: Agent[] = [
  {
    id: 'build',
    name: 'Build',
    kind: 'platform',
    description: '通用执行员 - 执行具体任务',
    capabilities: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'ls']
  },
  {
    id: 'plan',
    name: 'Plan',
    kind: 'platform',
    description: '任务规划员 - 分解复杂任务',
    capabilities: ['analysis', 'planning']
  },
  {
    id: 'explore',
    name: 'Explore',
    kind: 'platform',
    description: '信息探索员 - 搜索和分析代码',
    capabilities: ['search', 'analysis']
  }
]

export const agentRepository = {
  findAll(): Agent[] {
    const db = getDatabase()
    const dbAgents = db.prepare('SELECT * FROM agents').all() as any[]
    if (dbAgents.length === 0) {
      return platformAgents
    }
    return dbAgents.map(a => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: a.description,
      capabilities: a.capabilities ? JSON.parse(a.capabilities) : []
    }))
  },

  findById(id: string): Agent | null {
    const db = getDatabase()
    const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any
    if (!a) {
      return platformAgents.find(p => p.id === id) || null
    }
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      description: a.description,
      capabilities: a.capabilities ? JSON.parse(a.capabilities) : []
    }
  },

  upsert(agent: Agent): void {
    const db = getDatabase()
    db.prepare(`
      INSERT OR REPLACE INTO agents (id, name, kind, description, capabilities)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.kind,
      agent.description || null,
      JSON.stringify(agent.capabilities || [])
    )
  }
}
