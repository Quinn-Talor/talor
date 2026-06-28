import { describe, it, expect } from 'vitest'
import { buildAgentList } from './agent-list'
import type { AgentEntry, AgentProfile } from '@shared/types/agent'

const fp = (id: string): AgentProfile =>
  ({
    id,
    name: id,
    description: `${id} desc`,
    agentPrompt: 'prompt body long enough',
  }) as AgentProfile

const entry = (id: string): AgentEntry =>
  ({ profile: fp(id), dirPath: `/u/${id}`, status: 'ready' }) as AgentEntry

describe('buildAgentList', () => {
  it('feature agent 只读列出(readonly + dirPath=null + status ready),排在用户 agent 前', () => {
    const list = buildAgentList([entry('mine')], [fp('stock-research')])
    expect(list.map((a) => a.id)).toEqual(['stock-research', 'mine'])

    const feat = list.find((a) => a.id === 'stock-research')!
    expect(feat.readonly).toBe(true)
    expect(feat.dirPath).toBeNull()
    expect(feat.status).toBe('ready')

    const user = list.find((a) => a.id === 'mine')!
    expect(user.readonly).toBe(false)
    expect(user.dirPath).toBe('/u/mine')
  })

  it('用户 fork 同 id → 覆盖 feature(不重复,留可编辑用户版)', () => {
    const list = buildAgentList([entry('stock-research')], [fp('stock-research')])
    expect(list).toHaveLength(1)
    expect(list[0].readonly).toBe(false)
    expect(list[0].dirPath).toBe('/u/stock-research')
  })

  it('无 feature → 仅用户 agent', () => {
    const list = buildAgentList([entry('a')], [])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'a', readonly: false })
  })

  it('无用户 agent → 仅 feature(全只读)', () => {
    const list = buildAgentList([], [fp('x'), fp('y')])
    expect(list.map((a) => a.id)).toEqual(['x', 'y'])
    expect(list.every((a) => a.readonly)).toBe(true)
  })
})
