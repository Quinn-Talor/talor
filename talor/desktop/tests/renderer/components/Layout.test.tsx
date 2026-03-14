import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Layout } from '@/renderer/components/Layout'

describe('Layout', () => {
  it('should render children in main content', () => {
    render(
      <Layout>
        <div>Main Content</div>
      </Layout>
    )
    expect(screen.getByText('Main Content')).toBeInTheDocument()
  })

  it('should render with flex layout', () => {
    render(
      <Layout>
        <div>Content</div>
      </Layout>
    )
    const container = document.querySelector('.flex')
    expect(container).toBeInTheDocument()
  })
})
