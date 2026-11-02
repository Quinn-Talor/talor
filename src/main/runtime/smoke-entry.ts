// src/main/runtime/smoke-entry.ts — 主进程独立入口：在 Electron 里跑 agent-engine 冒烟
//
// 构建为 out/main/engine-smoke.js，用 `npx electron out/main/engine-smoke.js` 运行，不启动 Talor 应用。
// 运行档案写到临时目录的 SQLite 文件（验证 Electron ABI 下的 better-sqlite3），结束后删除。
// stdout 输出一行 `ENGINE_SMOKE <JSON>`；冒烟通过时退出码 0，否则 1。
// 设置 DEEPSEEK_API_KEY 时用 DeepSeek（模型取 DEEPSEEK_MODEL，缺省 deepseek-flash），否则用测试模型。
// API key 只从环境变量读取，不写入输出、日志与档案。
//
// 允许依赖: agent-engine、electron、@ai-sdk/openai、providers/middleware、runtime/smoke
// 禁止依赖: ipc/*、repos/*、db/*

import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { createOpenAI } from '@ai-sdk/openai'
import { app } from 'electron'
import log from 'electron-log'
import { aiSdkProvider, fakeModel, modelHub, sqliteArchive, type ModelHub } from 'agent-engine'
import { buildDisableThinkingFetch } from '../providers/middleware'
import { isSmokePassed, runEngineSmoke } from './smoke'

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash'
const DEEPSEEK_CONTEXT_LIMIT = 1_048_576

function smokeModels(): { label: 'deepseek' | 'fake'; models: ModelHub } {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (apiKey) {
    const model = createOpenAI({
      baseURL: DEEPSEEK_BASE_URL,
      apiKey,
      fetch: buildDisableThinkingFetch(),
    }).chat(process.env.DEEPSEEK_MODEL ?? DEEPSEEK_DEFAULT_MODEL)
    const provider = aiSdkProvider({
      id: 'deepseek',
      models: {
        main: { model, vendor: 'openai', capabilities: { contextLimit: DEEPSEEK_CONTEXT_LIMIT } },
      },
    })
    return {
      label: 'deepseek',
      models: modelHub({ providers: [provider], default: 'deepseek:main' }),
    }
  }
  const model = fakeModel({
    replies: [{ toolCalls: [{ name: 'add', input: { a: 17, b: 25 } }] }, { text: '42' }],
    repeatLast: true,
  })
  return { label: 'fake', models: modelHub({ providers: [model], default: model.ref }) }
}

async function main(): Promise<number> {
  await app.whenReady()
  const { label, models } = smokeModels()
  const file = join(app.getPath('temp'), `talor-engine-smoke-${Date.now()}.db`)
  const archive = sqliteArchive({ file })
  try {
    const result = await runEngineSmoke({ models, archive })
    process.stdout.write(`ENGINE_SMOKE ${JSON.stringify({ model: label, ...result })}\n`)
    return isSmokePassed(result) ? 0 : 1
  } finally {
    archive.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
  }
}

main().then(
  (code) => app.exit(code),
  (error: unknown) => {
    log.error('[engine-smoke] 冒烟失败:', error instanceof Error ? error.message : String(error))
    app.exit(1)
  },
)
