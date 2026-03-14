import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageList } from '@/renderer/components/MessageList'

describe('MessageList', () => {
  it('should render messages', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
    ]
    render(<MessageList messages={messages} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should show empty state', () => {
    render(<MessageList messages={[]} />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('should render multiple messages', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() },
      { id: '2', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() }
    ]
    render(<MessageList messages={messages} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })
})
