import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionList } from '@/renderer/components/SessionList'
import { useSessionStore } from '@/renderer/store/sessionStore'

describe('SessionList', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], currentSessionId: null })
  })

  it('should render sessions', () => {
    useSessionStore.setState({
      sessions: [
        { id: '1', title: 'Session 1', agentId: null, createdAt: Date.now(), updatedAt: Date.now() }
      ]
    })
    render(<SessionList />)
    expect(screen.getByText('Session 1')).toBeInTheDocument()
  })

  it('should render empty state', () => {
    render(<SessionList />)
    expect(screen.getByText('No sessions')).toBeInTheDocument()
  })

  it('should highlight current session', () => {
    useSessionStore.setState({
      sessions: [
        { id: '1', title: 'Session 1', agentId: null, createdAt: Date.now(), updatedAt: Date.now() }
      ],
      currentSessionId: '1'
    })
    render(<SessionList />)
    expect(screen.getByText('Session 1')).toBeInTheDocument()
  })
})
