// src/main/runtime/smoke.ts — 业务层：agent-engine 冒烟运行
//
// 用一个带 add 工具的 Agent 跑一次运行，读回运行档案，检查结局、工具调用与完整不变量。
// 单测与 Electron 冒烟入口（smoke-entry.ts）共用；每次调用自建引擎，不是全局引擎。
//
// 允许依赖: agent-engine、zod、runtime/logger
// 禁止依赖: ipc/*、repos/*、db/*

import { z } from 'zod'
import {
  checkInvariants,
  createEngine,
  defineAgent,
  defineTask,
  tools,
  type Archive,
  type ModelHub,
  type NormalizedUsage,
  type RunEvent,
  type RunStatus,
  type ToolDef,
} from 'agent-engine'
import { electronLogger } from './logger'

export interface EngineSmokeResult {
  status: RunStatus
  code?: string
  /** 模型或工具失败时分类后的错误码。 */
  errorCode?: string
  text?: string
  toolCalls: number
  /** 完整不变量检查的违规，格式为 `<编号>: <说明>`。 */
  invariantViolations: string[]
  archivedRuns: number
  usage: NormalizedUsage
}

const SMOKE_INSTRUCTIONS = '你是计算助手。需要计算时必须调用 add 工具，拿到结果后只回答数字。'
const SMOKE_INPUT = '用 add 工具计算 17 + 25，只回答结果。'

export const addTool: ToolDef = {
  name: 'add',
  description: '计算两个数的和',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execution: { effect: 'none' },
  async execute(input) {
    // 引擎已按 inputSchema 校验过输入
    const { a, b } = input as { a: number; b: number }
    return String(a + b)
  },
}

/** 冒烟通过：结局 completed、至少调用一次工具、完整不变量检查无违规。 */
export function isSmokePassed(result: EngineSmokeResult): boolean {
  return (
    result.status === 'completed' &&
    result.toolCalls >= 1 &&
    result.invariantViolations.length === 0
  )
}

export async function runEngineSmoke(opts: {
  models: ModelHub
  archive: Archive
  signal?: AbortSignal
}): Promise<EngineSmokeResult> {
  const engine = createEngine({
    services: { models: opts.models, archive: opts.archive, logger: electronLogger() },
  })
  const environment = engine.environment({ name: 'smoke', principal: { reachable: false } })
  const agent = defineAgent({
    id: 'engine-smoke',
    instructions: [{ role: 'system', parts: [{ type: 'text', text: SMOKE_INSTRUCTIONS }] }],
    capabilities: [tools([addTool])],
  })
  const task = defineTask({
    input: [{ role: 'user', parts: [{ type: 'text', text: SMOKE_INPUT }] }],
    budget: { maxSteps: 6, maxTotalMs: 120_000 },
  })

  const run = environment.start(agent, task)
  const onAbort = () => run.abort('smoke cancelled')
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const result = await run.result
    const events: RunEvent[] = []
    for await (const event of opts.archive.read(result.runId)) events.push(event)
    const { input, output, cacheRead, cacheWrite } = result.usage
    return {
      status: result.status,
      ...(result.code !== undefined ? { code: result.code } : {}),
      ...(result.error ? { errorCode: result.error.code } : {}),
      ...(result.text !== undefined ? { text: result.text } : {}),
      toolCalls: result.toolCalls,
      invariantViolations: checkInvariants(events, { complete: true }).map(
        (v) => `${v.invariant}: ${v.message}`,
      ),
      archivedRuns: (await opts.archive.query({})).length,
      usage: { input, output, cacheRead, cacheWrite },
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
