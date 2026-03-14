import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentSelector } from '@/renderer/components/AgentSelector'
import { useAgentStore } from '@/renderer/store/agentStore'

describe('AgentSelector', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        { id: 'build', name: 'Build', kind: 'platform', description: 'General executor' }
      ],
      currentAgentId: 'build'
    })
  })

  it('should render agent list', () => {
    render(<AgentSelector />)
    expect(screen.getByText('Build')).toBeInTheDocument()
  })

  it('should render agent label', () => {
    render(<AgentSelector />)
    expect(screen.getByText('Agent:')).toBeInTheDocument()
  })
})
