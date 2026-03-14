import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/renderer/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    deps: {
      inline: ['electron', '@electron-toolkit/utils']
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  }
})
