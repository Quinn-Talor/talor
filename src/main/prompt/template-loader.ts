// src/main/prompt/template-loader.ts — 基础设施层：prompt 模板统一加载
//
// 单一来源加载 agent-system-prompt.v1.md。
//
// 设计：用 Vite `?raw` import 在编译期把模板内容内联进 bundle,
// 解决 electron-builder 打包后 process.cwd() 路径不可用问题(审查偏差 #1)。
// fallback 到 fs read 仅供未走 vite 编译的特殊场景(单测直跑等)。
//
// 允许依赖：仅 Node 标准库 + Vite ?raw import
// 禁止依赖：ipc/*

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Vite ?raw 编译期内联(production / dev / vitest 都生效)
import inlinedTemplate from './templates/agent-system-prompt.v1.md?raw'

let cached: string | null = inlinedTemplate ?? null

/**
 * 加载 agent system prompt 模板。
 * 优先使用编译期 ?raw 内联结果;若上游未走 Vite (例如直接用 ts-node 跑某些 cli),fallback 到 fs。
 */
export function loadAgentSystemPromptTemplate(): string {
  if (cached) return cached
  try {
    cached = readFileSync(
      join(process.cwd(), 'src/main/prompt/templates/agent-system-prompt.v1.md'),
      'utf-8',
    )
  } catch {
    cached = ''
  }
  return cached
}

// 测试钩子:重置缓存。
export function _resetTemplateCache(): void {
  cached = inlinedTemplate ?? null
}
