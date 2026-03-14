import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentList } from '@/renderer/components/AgentList'
import { useAgentStore } from '@/renderer/store/agentStore'

describe('AgentList', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        { id: 'build', name: 'Build', kind: 'platform', description: 'General executor', capabilities: ['bash', 'read'] }
      ],
      currentAgentId: 'build'
    })
  })

  it('should render agent list', () => {
    render(<AgentList />)
    expect(screen.getByText('Build')).toBeInTheDocument()
  })

  it('should show management title', () => {
    render(<AgentList />)
    expect(screen.getByText('Agent Management')).toBeInTheDocument()
  })

  it('should show platform badge', () => {
    render(<AgentList />)
    expect(screen.getByText('platform')).toBeInTheDocument()
  })
})
