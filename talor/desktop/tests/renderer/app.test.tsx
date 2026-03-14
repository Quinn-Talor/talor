import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../../src/renderer/App'

describe('App', () => {
  it('should render title', () => {
    render(<App />)
    expect(screen.getByText('Talor Desktop')).toBeInTheDocument()
  })
})
