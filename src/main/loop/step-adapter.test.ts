import { describe, it, expect } from 'vitest'
import type { StepResult, ToolSet } from 'ai'
import {
  canonicalizeJson,
  extractRawForHash,
  sha8,
  stepSignature,
  isSubagentFailureOutput,
  extractTextFromStep,
  toolCallsFromStep,
  toolResultsFromStep,
  deriveAllToolsFailed,
  factsFromStep,
  outcomeFromStep,
} from './step-adapter'

// 构造一个最小 StepResult mock (只填 adapter 用到的字段)
function makeStep(o: {
  text?: string
  reasoningText?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>
  finishReason?: import('ai').FinishReason
}): StepResult<ToolSet> {
  return {
    text: o.text ?? '',
    reasoningText: o.reasoningText,
    toolCalls: (o.toolCalls ?? []) as unknown as StepResult<ToolSet>['toolCalls'],
    toolResults: (o.toolResults ?? []) as unknown as StepResult<ToolSet>['toolResults'],
    finishReason: o.finishReason ?? 'stop',
    content: [],
    reasoning: [],
    files: [],
    sources: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    staticToolResults: [],
    dynamicToolResults: [],
    rawFinishReason: undefined,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warnings: undefined,
    request: {},
    response: { messages: [] },
    providerMetadata: undefined,
  } as unknown as StepResult<ToolSet>
}

describe('canonicalizeJson — 键顺序无感', () => {
  it('对象键排序后再序列化', () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe(canonicalizeJson({ a: 1, b: 2 }))
  })
  it('嵌套对象递归排序', () => {
    expect(canonicalizeJson({ a: { y: 1, x: 2 } })).toBe(canonicalizeJson({ a: { x: 2, y: 1 } }))
  })
  it('数组保留顺序', () => {
    expect(canonicalizeJson([1, 2, 3])).toBe('[1,2,3]')
    expect(canonicalizeJson([1, 2])).not.toBe(canonicalizeJson([2, 1]))
  })
  it('null / undefined 都视为 null', () => {
    expect(canonicalizeJson(null)).toBe('null')
    expect(canonicalizeJson(undefined)).toBe('null')
  })
})

describe('extractRawForHash', () => {
  it('找到 [Raw output] 后取后续 500 字节', () => {
    const out = 'long guidance prefix...---\n[Raw output]\nACTUAL_RAW'
    expect(extractRawForHash(out)).toBe('ACTUAL_RAW')
  })
  it('无 marker 时 fallback 整条 (前 500 字节)', () => {
    expect(extractRawForHash('short')).toBe('short')
  })
})

describe('sha8', () => {
  it('返 8 位 hex', () => {
    expect(sha8('hello')).toMatch(/^[a-f0-9]{8}$/)
  })
  it('稳定 — 同输入同输出', () => {
    expect(sha8('x')).toBe(sha8('x'))
  })
})

describe('stepSignature', () => {
  it('无工具调用 → 空串', () => {
    expect(stepSignature([], [])).toBe('')
  })

  it('单工具调用 — toolName#inputHash:outputHash', () => {
    const sig = stepSignature(
      [{ toolCallId: 't1', toolName: 'read', input: { path: 'a' } }],
      [{ toolCallId: 't1', toolName: 'read', output: 'content' }],
    )
    expect(sig).toMatch(/^read#[a-f0-9]{8}:[a-f0-9]{8}$/)
  })

  it('同 input 不同顺序键 → 同签名', () => {
    const sig1 = stepSignature(
      [{ toolCallId: 't1', toolName: 'read', input: { a: 1, b: 2 } }],
      [{ toolCallId: 't1', toolName: 'read', output: 'x' }],
    )
    const sig2 = stepSignature(
      [{ toolCallId: 't1', toolName: 'read', input: { b: 2, a: 1 } }],
      [{ toolCallId: 't1', toolName: 'read', output: 'x' }],
    )
    expect(sig1).toBe(sig2)
  })

  it('多工具调用 — sorted join', () => {
    const sig = stepSignature(
      [
        { toolCallId: 't1', toolName: 'read', input: { p: 'a' } },
        { toolCallId: 't2', toolName: 'bash', input: { c: 'ls' } },
      ],
      [
        { toolCallId: 't1', toolName: 'read', output: 'foo' },
        { toolCallId: 't2', toolName: 'bash', output: 'bar' },
      ],
    )
    // sorted: bash# 在 read# 前
    expect(sig.startsWith('bash#')).toBe(true)
    expect(sig).toContain('|')
  })

  it('output 缺失 → outputHash=none', () => {
    const sig = stepSignature(
      [{ toolCallId: 't1', toolName: 'read', input: {} }],
      [{ toolCallId: 't1', toolName: 'read', output: '' }],
    )
    expect(sig).toContain(':none')
  })
})

describe('isSubagentFailureOutput', () => {
  it('SUBAGENT_ 前缀的 envelope → true', () => {
    expect(
      isSubagentFailureOutput({ __talor_error: true, code: 'SUBAGENT_TIMEOUT', message: 'x' }),
    ).toBe(true)
  })
  it('DELEGATION_BUDGET_EXHAUSTED → true', () => {
    expect(
      isSubagentFailureOutput({ __talor_error: true, code: 'DELEGATION_BUDGET_EXHAUSTED' }),
    ).toBe(true)
  })
  it('普通 envelope → false', () => {
    expect(isSubagentFailureOutput({ __talor_error: true, code: 'ZOD_VALIDATION' })).toBe(false)
  })
  it('非 envelope → false', () => {
    expect(isSubagentFailureOutput('plain string')).toBe(false)
    expect(isSubagentFailureOutput(null)).toBe(false)
  })
})

describe('extractTextFromStep / toolCalls / toolResults', () => {
  it('text from step.text', () => {
    expect(extractTextFromStep(makeStep({ text: 'hello' }))).toBe('hello')
  })
  it('text 缺失 → 空串', () => {
    expect(extractTextFromStep(makeStep({}))).toBe('')
  })
  it('toolCalls 精简成 {toolCallId,toolName,input}', () => {
    const tc = toolCallsFromStep(
      makeStep({
        toolCalls: [{ toolCallId: 't1', toolName: 'read', input: { path: 'a' } }],
      }),
    )
    expect(tc).toEqual([{ toolCallId: 't1', toolName: 'read', input: { path: 'a' } }])
  })
  it('toolResults 精简成 {toolCallId,toolName,output}', () => {
    const tr = toolResultsFromStep(
      makeStep({
        toolResults: [{ toolCallId: 't1', toolName: 'read', output: 'x' }],
      }),
    )
    expect(tr).toEqual([{ toolCallId: 't1', toolName: 'read', output: 'x' }])
  })
})

describe('deriveAllToolsFailed — 三态语义', () => {
  it('无工具 → null', () => {
    expect(deriveAllToolsFailed([])).toBe(null)
  })
  it('全部 error → true', () => {
    expect(
      deriveAllToolsFailed([
        { output: 'File not found: x' },
        { output: { __talor_error: true, code: 'X' } },
      ]),
    ).toBe(true)
  })
  it('至少一个成功 → false', () => {
    expect(deriveAllToolsFailed([{ output: 'File not found: x' }, { output: 'ok content' }])).toBe(
      false,
    )
  })
})

describe('factsFromStep — 集成派生', () => {
  it('text + tool → hasToolCall=true, hasText=true', () => {
    const f = factsFromStep(
      makeStep({
        text: 'doing X',
        toolCalls: [{ toolCallId: 't1', toolName: 'read', input: { p: 'a' } }],
        toolResults: [{ toolCallId: 't1', toolName: 'read', output: 'x' }],
      }),
    )
    expect(f.hasToolCall).toBe(true)
    expect(f.hasText).toBe(true)
    expect(f.allToolsFailed).toBe(false)
    expect(f.signature).not.toBe('')
  })

  it('纯文本 → hasToolCall=false, signature 空', () => {
    const f = factsFromStep(makeStep({ text: 'reply' }))
    expect(f.hasToolCall).toBe(false)
    expect(f.signature).toBe('')
  })

  it('subagent 失败 → isSubagentFailure=true', () => {
    const f = factsFromStep(
      makeStep({
        toolCalls: [{ toolCallId: 't1', toolName: 'delegate_agent', input: {} }],
        toolResults: [
          {
            toolCallId: 't1',
            toolName: 'delegate_agent',
            output: { __talor_error: true, code: 'SUBAGENT_TIMEOUT', message: 'x' },
          },
        ],
      }),
    )
    expect(f.isSubagentFailure).toBe(true)
    expect(f.allToolsFailed).toBe(true)
  })
})

describe('outcomeFromStep — 兼容 v3 StepOutcome', () => {
  it('工具步 — shouldContinue=true, toolNames 列出', () => {
    const o = outcomeFromStep(
      makeStep({
        toolCalls: [{ toolCallId: 't1', toolName: 'read', input: { p: 'a' } }],
        toolResults: [{ toolCallId: 't1', toolName: 'read', output: 'x' }],
        finishReason: 'tool-calls',
      }),
    )
    expect(o.shouldContinue).toBe(true)
    expect(o.toolNames).toEqual(['read'])
    expect(o.finishReason).toBe('tool-calls')
  })
  it('纯文本步 — shouldContinue=false, stepText 含 text', () => {
    const o = outcomeFromStep(makeStep({ text: 'hello' }))
    expect(o.shouldContinue).toBe(false)
    expect(o.stepText).toBe('hello')
  })
})
