import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom'

afterEach(() => {
  cleanup()
})

global.window = global.window || {}
global.window.api = {
  invoke: vi.fn().mockResolvedValue({}),
  on: vi.fn().mockReturnValue(() => {}),
  off: vi.fn()
}
