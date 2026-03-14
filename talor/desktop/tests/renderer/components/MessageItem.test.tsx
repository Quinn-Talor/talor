import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageItem } from '@/renderer/components/MessageItem'

describe('MessageItem', () => {
  it('should render user message', () => {
    const message = { id: '1', role: 'user' as const, content: 'Hello', timestamp: Date.now() }
    render(<MessageItem message={message} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('should render assistant message', () => {
    const message = { id: '2', role: 'assistant' as const, content: 'Hi there', timestamp: Date.now() }
    render(<MessageItem message={message} />)
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })

  it('should show role badge for user', () => {
    const message = { id: '3', role: 'user' as const, content: 'Test', timestamp: Date.now() }
    render(<MessageItem message={message} />)
    expect(screen.getByText('User')).toBeInTheDocument()
  })

  it('should show role badge for assistant', () => {
    const message = { id: '4', role: 'assistant' as const, content: 'Response', timestamp: Date.now() }
    render(<MessageItem message={message} />)
    expect(screen.getByText('Assistant')).toBeInTheDocument()
  })
})
