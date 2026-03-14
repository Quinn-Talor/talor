import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatView } from '@/renderer/components/ChatView'
import { useSessionStore } from '@/renderer/store/sessionStore'

describe('ChatView', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], currentSessionId: null })
  })

  it('should render placeholder when no session', () => {
    render(<ChatView />)
    expect(screen.getByText('Select a session to start')).toBeInTheDocument()
  })

  it('should render session title when session selected', () => {
    useSessionStore.setState({
      sessions: [
        { id: '1', title: 'Test Session', agentId: null, createdAt: Date.now(), updatedAt: Date.now() }
      ],
      currentSessionId: '1'
    })
    render(<ChatView />)
    expect(screen.getByText('Test Session')).toBeInTheDocument()
  })
})
