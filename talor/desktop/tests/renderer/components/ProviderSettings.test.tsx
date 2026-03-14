import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderSettings } from '@/renderer/components/ProviderSettings'
import { useProviderStore } from '@/renderer/store/providerStore'

describe('ProviderSettings', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        { id: 'ollama', name: 'Ollama', type: 'ollama' as const, baseUrl: 'http://localhost:11434', models: [], isConfigured: true },
        { id: 'openai', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com/v1', models: [], isConfigured: false }
      ],
      activeProviderId: 'ollama'
    })
  })

  it('should render provider list', () => {
    render(<ProviderSettings />)
    expect(screen.getByText('Ollama')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
  })

  it('should show active indicator', () => {
    render(<ProviderSettings />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('should have settings title', () => {
    render(<ProviderSettings />)
    expect(screen.getByText('Provider Settings')).toBeInTheDocument()
  })
})
