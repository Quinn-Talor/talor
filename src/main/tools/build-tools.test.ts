// buildTools 单测：工具执行收口的 TOOL observation（turn-trace TASK-5）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_TRACE_CONFIG, type ObservationRecord } from '@shared/types/trace'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { buildTools } from './build-tools'
import type { RiskGate } from './risk-gate'
import type { ToolExecuteContext, ToolMetadata } from './types'
import type { Agent } from '../agent/agent'
import { traceRecorder } from '../observe/trace-recorder'
import { traceRepo } from '../repos/trace-repo'
import { runInScope } from '../observe/trace-context'

const ECHO: ToolMetadata = {
  name: 'echo',
  description: 'echo input',
  parameters: { type: 'object', properties: {} },
  riskLevel: 'LOW',
}

type Execute = (
  name: string,
  input: unknown,
  ctx: ToolExecuteContext,
) => Promise<{ output: unknown }>

function makeAgent(execute: Execute): Agent {
  return { id: 'a1', toolRegistry: { execute, listTools: () => [] } } as unknown as Agent
}

function makeGate(decision: 'pass' | 'deny' | 'throw'): RiskGate {
  return {
    gate: vi.fn(async () => {
      if (decision === 'throw') throw new Error('gate broke')
      return decision === 'pass'
        ? { action: 'pass', via: 'auto-low' }
        : { action: 'deny', via: 'fallback', summary: 'rm -rf' }
    }),
  } as unknown as RiskGate
}

async function runEcho(execute: Execute, decision: 'pass' | 'deny' | 'throw'): Promise<unknown> {
  const tools = await buildTools({
    sessionId: 's-1',
    messageId: 'm-1',
    workspace: '/tmp',
    confirmTool: vi.fn(async () => true),
    agent: makeAgent(execute),
    toolSchemas: [ECHO],
    riskGate: makeGate(decision),
  })
  const run = tools!.echo.execute as (input: unknown, options: unknown) => Promise<unknown>
  return run({ text: 'hi' }, { toolCallId: 'call-1', messages: [] })
}

let rows: Map<string, ObservationRecord>

beforeEach(() => {
  rows = new Map()
  vi.spyOn(traceRepo, 'upsertBatch').mockImplementation((_trace, observations) => {
    for (const o of observations) rows.set(o.id, { ...o })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 在 trace + step scope 内执行（buildTools 在 step 内被调用，与 react-loop 一致）。 */
async function inStep(traceId: string, fn: () => Promise<void>): Promise<string> {
  let stepId = ''
  const scope = traceRecorder.startTrace({
    id: traceId,
    sessionId: 's-1',
    name: 'turn',
    input: 'x',
    rootName: 'agent:test',
    config: DEFAULT_TRACE_CONFIG,
  })
  await runInScope(scope, () =>
    traceRecorder.withObservation({ type: 'CHAIN', name: 'react.step' }, async (step) => {
      stepId = step.ref!.observationId
      await fn()
    }),
  )
  traceRecorder.endTrace(traceId, {})
  return stepId
}

function toolRows(): ObservationRecord[] {
  return [...rows.values()].filter((o) => o.type === 'TOOL')
}

describe('buildTools — TOOL observation', () => {
  it('AC-015: one TOOL observation per execution under the step; tool return values unchanged', async () => {
    const outputs: unknown[] = []
    const stepId = await inStep('t-tool', async () => {
      outputs.push(await runEcho(async () => ({ output: 'ok' }), 'pass'))
      outputs.push(
        await runEcho(
          async () => ({ output: { __talor_error: true, code: 'X_FAIL', message: 'm' } }),
          'pass',
        ),
      )
      outputs.push(await runEcho(vi.fn(), 'deny'))
      outputs.push(
        await runEcho(async () => {
          throw new Error('crash')
        }, 'pass'),
      )
    })

    const tools = toolRows()
    expect(tools).toHaveLength(4)
    for (const t of tools) {
      expect(t.name).toBe('echo')
      expect(t.parent_observation_id).toBe(stepId)
      expect(t.metadata.tool_call_id).toBe('call-1')
      expect(t.metadata.risk_level).toBe('LOW')
      expect(Number.isInteger(t.metadata.gate_ms)).toBe(true)
      expect(t.metadata.gate_ms as number).toBeGreaterThanOrEqual(0)
      expect(t.end_time).not.toBeNull()
    }
    expect(tools.map((t) => [t.level, t.status_message])).toEqual([
      ['DEFAULT', null],
      ['ERROR', 'X_FAIL'],
      ['WARNING', 'USER_DENIED'],
      ['ERROR', 'TOOL_EXCEPTION'],
    ])
    expect(outputs[0]).toBe('ok')
    expect(outputs[1]).toMatchObject({ code: 'X_FAIL' })
    expect(outputs[2]).toMatchObject({ __talor_error: true, code: 'USER_DENIED' })
    expect(outputs[3]).toBe('Tool execution failed: crash')
  })

  it('a RiskGate exception is recorded as ERROR / RISK_GATE_ERROR', async () => {
    let out: unknown
    await inStep('t-gate', async () => {
      out = await runEcho(vi.fn(), 'throw')
    })
    expect(out).toMatchObject({ code: 'RISK_GATE_ERROR' })
    expect(toolRows()[0]).toMatchObject({ level: 'ERROR', status_message: 'RISK_GATE_ERROR' })
  })

  it('error-prefixed string outputs are recorded as ERROR / TOOL_ERROR_OUTPUT', async () => {
    await inStep('t-errstr', async () => {
      await runEcho(async () => ({ output: 'File not found: /tmp/missing.txt' }), 'pass')
    })
    expect(toolRows()[0]).toMatchObject({ level: 'ERROR', status_message: 'TOOL_ERROR_OUTPUT' })
  })

  it('the tool sees its TOOL observation as traceParent and runs inside it', async () => {
    let seen: ToolExecuteContext | undefined
    await inStep('t-parent', async () => {
      await runEcho(async (_n, _i, ctx) => {
        seen = ctx
        traceRecorder.startObservation({ type: 'SPAN', name: 'inner' }).end()
        return { output: 'ok' }
      }, 'pass')
    })
    const tool = toolRows()[0]
    expect(seen?.traceParent).toEqual({ traceId: 't-parent', observationId: tool.id })
    const inner = [...rows.values()].find((o) => o.name === 'inner')!
    expect(inner.parent_observation_id).toBe(tool.id)
  })

  it('without a trace scope tools behave exactly as before and nothing is recorded', async () => {
    let seen: ToolExecuteContext | undefined
    const out = await runEcho(async (_n, _i, ctx) => {
      seen = ctx
      return { output: 'ok' }
    }, 'pass')
    expect(out).toBe('ok')
    expect(seen?.traceParent).toBeUndefined()
    expect(traceRepo.upsertBatch).not.toHaveBeenCalled()
  })
})
