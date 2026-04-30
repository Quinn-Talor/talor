import { defineConfig } from 'vitest/config'
import path from 'path'

// Vitest 只跑单元测试。tests/e2e/ 下的 playwright 规约由 `npx playwright test` 单独执行。
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'out', 'build', 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@preload': path.resolve(__dirname, 'src/preload'),
    },
  },
})
