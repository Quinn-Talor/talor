import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PromptInput } from '@/renderer/components/PromptInput'

describe('PromptInput', () => {
  it('should render input and send button', () => {
    render(<PromptInput onSend={() => {}} />)
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    expect(screen.getByText('Send')).toBeInTheDocument()
  })

  it('should call onSend when button clicked', () => {
    const onSend = vi.fn()
    render(<PromptInput onSend={onSend} />)
    fireEvent.change(screen.getByPlaceholderText('Type a message...'), { 
      target: { value: 'Hello' } 
    })
    fireEvent.click(screen.getByText('Send'))
    expect(onSend).toHaveBeenCalledWith('Hello')
  })

  it('should not call onSend when input is empty', () => {
    const onSend = vi.fn()
    render(<PromptInput onSend={onSend} />)
    fireEvent.click(screen.getByText('Send'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('should send on Enter key', () => {
    const onSend = vi.fn()
    render(<PromptInput onSend={onSend} />)
    fireEvent.change(screen.getByPlaceholderText('Type a message...'), { 
      target: { value: 'Hello' } 
    })
    fireEvent.keyDown(screen.getByPlaceholderText('Type a message...'), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('Hello')
  })
})
