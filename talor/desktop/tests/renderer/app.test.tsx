import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/App'

describe('App', () => {
  it('should render layout with sidebar', () => {
    render(<App />)
    expect(screen.getByText('Talor')).toBeInTheDocument()
  })

  it('should show session placeholder', () => {
    render(<App />)
    expect(screen.getByText('Select a session to start')).toBeInTheDocument()
  })
})
