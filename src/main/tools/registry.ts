// src/main/tools/registry.ts — 内置工具注册中心
//
// 仅管理内置工具（read/write/edit/ls/glob/grep/bash）。
// MCP 工具由 McpRegistry 管理，不在此注册。
// Agent 的 ToolRegistry（agent/agent-toolset.ts）组合本模块 + McpRegistry → 白名单过滤。

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type {
  ToolDefinition,
  ToolResult,
  ToolExecuteContext,
  ToolMetadata,
  ToolErrorEnvelope,
} from './types'
import { diagnoseInputMismatch } from './input-diagnostics'
import { checkSchema, type SchemaParams } from './schema-check'
import { formatZodError } from './zod-diagnostics'
export type { ToolDefinition, ToolResult, ToolExecuteContext, ToolMetadata } from './types'
import {
  DEFAULT_MAX_READ_SIZE_BYTES,
  DEFAULT_MAX_WRITE_SIZE_BYTES,
  DEFAULT_MAX_PARALLEL_TOOLS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './types'

const tools = new Map<string, ToolDefinition>()

function applyContextDefaults(context: ToolExecuteContext): ToolExecuteContext {
  return {
    ...context,
    maxReadSizeBytes: context.maxReadSizeBytes ?? DEFAULT_MAX_READ_SIZE_BYTES,
    maxWriteSizeBytes: context.maxWriteSizeBytes ?? DEFAULT_MAX_WRITE_SIZE_BYTES,
    maxParallelTools: context.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS,
    toolTimeoutMs: context.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
  }
}

export const toolRegistry = {
  register(tool: ToolDefinition): void {
    if (!tool.name) throw new Error('Tool must have a name')
    if (!tool.description) throw new Error('Tool must have a description')
    if (typeof tool.execute !== 'function') throw new Error('Tool must have an execute function')
    if (tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`)
    tools.set(tool.name, tool)
  },

  unregister(name: string): void {
    if (!tools.has(name)) throw new Error(`Tool not found: ${name}`)
    tools.delete(name)
  },

  getTool(name: string): ToolDefinition | undefined {
    return tools.get(name)
  },

  listTools(): string[] {
    return Array.from(tools.keys())
  },

  listAll(): ToolDefinition[] {
    return Array.from(tools.values())
  },

  getAllSchemas(): ToolMetadata[] {
    return Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
    }))
  },

  get size(): number {
    return tools.size
  },

  clear(): void {
    tools.clear()
  },

  async execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const tool = tools.get(toolName)
    if (!tool) throw new Error(`Tool not found: ${toolName}`)

    const toolCallId = uuidv4()
    const ctx = applyContextDefaults(context)
    const startTime = Date.now()

    // Phase 1: 参数校验。两条路径(二选一)
    //
    //   (A) Zod 路径:工具定义 zodSchema → safeParse,失败格式化诊断,
    //       成功时把 parsed data 作为 input 继续下发(包含 trim/default 变换)。
    //   (B) 手写路径:fallback 到 validateRequiredFields + checkSchema。
    //       MCP 工具走这条,因为 schema 来自远端 JSON Schema,没法 Zod 化。
    let validatedInput: unknown = input
    if (tool.zodSchema) {
      const parsed = tool.zodSchema.safeParse(input)
      if (!parsed.success) {
        const msg = formatZodError(tool.name, tool.parameters, input, parsed.error)
        log.warn(`[Registry] Zod validation failed: ${toolName} — ${msg}`)
        return { toolCallId, toolName, output: msg, durationMs: Date.now() - startTime }
      }
      validatedInput = parsed.data
    } else {
      const schemaError = validateRequiredFields(tool, input)
      if (schemaError) {
        log.warn(`[Registry] Schema validation failed: ${toolName} — ${schemaError}`)
        return { toolCallId, toolName, output: schemaError, durationMs: Date.now() - startTime }
      }
      const typeError = checkSchema(tool.name, tool.parameters as SchemaParams, input)
      if (typeError) {
        log.warn(`[Registry] Schema type check failed: ${toolName} — ${typeError}`)
        return { toolCallId, toolName, output: typeError, durationMs: Date.now() - startTime }
      }
    }

    // Phase 2: tool.validate (tool-level business rules, synchronous)
    if (tool.validate) {
      const vr = tool.validate(validatedInput, ctx)
      if (!vr.ok) {
        log.warn(`[Registry] Validate failed: ${toolName} — ${vr.error}`)
        return { toolCallId, toolName, output: vr.error!, durationMs: Date.now() - startTime }
      }
    }

    // Phase 3: execute
    let rawOutput: unknown
    try {
      const result = await tool.execute(validatedInput, ctx)
      rawOutput = result.output
    } catch (err) {
      return {
        toolCallId,
        toolName,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      }
    }

    // Phase 4: tool.verify (output post-processing, may be async)
    if (tool.verify) {
      try {
        const vr = await tool.verify(rawOutput, validatedInput, ctx)
        // severity='block' + !ok 时,verify 主动判定输出不合格 → 强制转换为错误信封,
        // 不能静默回退 rawOutput 否则幻觉检测/用户提示都被绕过。
        if (vr.severity === 'block' && !vr.ok) {
          const envelope: ToolErrorEnvelope = {
            __talor_error: true,
            code: 'VERIFY_BLOCKED',
            message: vr.warning ?? 'Output failed verification',
          }
          log.warn(`[Registry] Verify blocked: ${toolName} — ${envelope.message}`)
          return { toolCallId, toolName, output: envelope, durationMs: Date.now() - startTime }
        }
        if (vr.warning) log.warn(`[Registry] Verify warning: ${toolName} — ${vr.warning}`)
        return { toolCallId, toolName, output: vr.output, durationMs: Date.now() - startTime }
      } catch (err) {
        // verify 抛异常 = 验证逻辑本身崩了,不能假装原输出是好的。
        // 旧行为"回退 rawOutput"会掩盖 verify 已经发现的问题。
        log.error(`[Registry] Verify threw: ${toolName}`, err)
        const envelope: ToolErrorEnvelope = {
          __talor_error: true,
          code: 'VERIFY_CRASH',
          message: err instanceof Error ? err.message : String(err),
        }
        return { toolCallId, toolName, output: envelope, durationMs: Date.now() - startTime }
      }
    }

    return { toolCallId, toolName, output: rawOutput, durationMs: Date.now() - startTime }
  },
}

function validateRequiredFields(tool: ToolDefinition, input: unknown): string | null {
  const params = tool.parameters as {
    required?: string[]
    properties?: Record<string, { type?: string; description?: string }>
  }
  const obj = (input ?? {}) as Record<string, unknown>

  // 先收集所有缺失的 required 字段,一次性给诊断消息,避免模型修一个错一个。
  const missing: string[] = []
  for (const field of params.required ?? []) {
    if (obj[field] === undefined || obj[field] === null) missing.push(field)
  }
  if (missing.length > 0) {
    return diagnoseInputMismatch(tool.name, params, input, missing)
  }

  // 类型检查(在所有 required 都提供之后)
  for (const field of params.required ?? []) {
    const expectedType = params.properties?.[field]?.type
    if (expectedType && typeof obj[field] !== expectedType) {
      return `Invalid type for "${field}" on tool "${tool.name}": expected ${expectedType}, got ${typeof obj[field]}. Value: ${JSON.stringify(obj[field]).slice(0, 100)}`
    }
  }
  return null
}
