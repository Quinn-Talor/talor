import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore } from '@/renderer/store/agentStore'

describe('AgentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        { id: 'build', name: 'Build', kind: 'platform', description: 'General executor' }
      ],
      currentAgentId: 'build'
    })
  })

  it('should have platform agents', () => {
    const { agents } = useAgentStore.getState()
    expect(agents.length).toBeGreaterThan(0)
    expect(agents.some(a => a.kind === 'platform')).toBe(true)
  })

  it('should set current agent', () => {
    const { agents, setCurrentAgent } = useAgentStore.getState()
    setCurrentAgent(agents[0].id)
    expect(useAgentStore.getState().currentAgentId).toBe(agents[0].id)
  })

  it('should have build agent by default after init', () => {
    expect(useAgentStore.getState().currentAgentId).toBe('build')
  })
})
