import { defineConfig } from '@playwright/test'

// Electron E2E(真 IPC+SQLite)。只跑 *.e2e.ts;旧的 *.spec.ts 不在此列。
// 前置:已 build(out/) + better-sqlite3 为 electron ABI(npm run rebuild:electron)。
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
})
