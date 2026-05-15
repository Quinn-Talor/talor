// src/shared/talor-blocks/talor-block-parser.ts —— 业务层: Talor Block JSONC parser
//
// 从 stepText 中提取所有 ```talor ... ``` fenced blocks, 解析为强类型 TalorBlock。
//
// 用 jsonc-parser 库 (~10KB) 提供 JSONC 容错: 注释 + trailing comma + lenient
// error recovery — 比 JSON.parse 对弱模型友好得多。
//
// 流式辅助 detectStreamingTalorType: 即便 JSONC 未完整, 只要 type 字段已流出,
// 即可早期决定 UI 骨架渲染哪种 placeholder。
//
// 允许依赖: ./talor-block-schema, jsonc-parser
// 禁止依赖: ipc/*

import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type { TalorBlock, TalorBlockType } from './talor-block-schema'

/**
 * 匹配 fenced talor block。
 *
 * 注意:
 *   - fence tag 严格 `talor` (不允许 `talor:xxx` 后缀, 类型在 JSON 内)
 *   - 允许 fence 前后有 trailing spaces (markdown 兼容)
 *   - 内容必须以 `\n` 开头 (markdown fence 标准)
 */
const TALOR_BLOCK_RE = /```talor[ \t]*\n([\s\S]+?)\n[ \t]*```/g

/**
 * 流式 type 提取的 regex —— 不要求 JSONC 闭合, 只要 fence 内任意位置出现
 * "type": "<name>" 即匹配。
 *
 * v3.7.1: 改为位置无关 (此前要求 type 紧跟 `{`, 反过来要求 LLM 守"type 必须
 * first key"的反 JSON 惯例 — 属于系统侧 streaming 便利压给 LLM 负担)。
 *
 * 边界 case: 模型在 JSON value 里写假 `"type":"..."` 字符串 (例如 summary 里
 * quote 别人的代码) → streaming 期间可能短暂误判类型。但 JSONC 闭合后 parser
 * 取真实 block 仍正确,UI 骨架短暂错样式代价极小。
 *
 * 见 docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md §6
 * Cleanup 3。
 */
const STREAMING_TYPE_RE = /```talor[ \t]*\n[\s\S]*?"type"\s*:\s*"(\w+)"/g

/**
 * 解析 stepText 中的所有 talor blocks。
 *
 * 返回:
 *   - blocks: 成功解析的 TalorBlock[] (字段校验已通过)
 *   - invalid: 解析失败的原始块 + 失败原因 (供 UI 错误兜底渲染 / 日志)
 *
 * 失败原因覆盖:
 *   - 'jsonc-parse-error': JSONC 解析失败 (字符串错位、引号未闭合等)
 *   - 'not-object': 解析结果不是 object
 *   - 'missing-type': 缺 type 字段或 type 不是字符串
 *   - 'unknown-type': type 不在 V1 支持的 5 个中
 *   - 'field-validation': type 已知但必填字段缺失/类型错
 */
export function parseTalorBlocks(stepText: string): {
  blocks: TalorBlock[]
  invalid: Array<{ raw: string; reason: string }>
} {
  const blocks: TalorBlock[] = []
  const invalid: Array<{ raw: string; reason: string }> = []

  for (const match of stepText.matchAll(TALOR_BLOCK_RE)) {
    const raw = match[1]
    const errors: ParseError[] = []
    const parsed = parseJsonc(raw, errors, { allowTrailingComma: true })

    if (errors.length > 0) {
      invalid.push({ raw, reason: 'jsonc-parse-error' })
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      invalid.push({ raw, reason: 'not-object' })
      continue
    }

    const obj = parsed as Record<string, unknown>
    if (typeof obj.type !== 'string') {
      invalid.push({ raw, reason: 'missing-type' })
      continue
    }

    const type = obj.type as TalorBlockType
    if (!isV1Type(type)) {
      invalid.push({ raw, reason: `unknown-type: ${type}` })
      continue
    }

    if (!validateBlockFields(type, obj)) {
      invalid.push({ raw, reason: `field-validation: ${type}` })
      continue
    }

    blocks.push(obj as unknown as TalorBlock)
  }

  return { blocks, invalid }
}

/**
 * 从流式中 (未必完整) 的 stepText 提取最近一个 talor block 的 type。
 *
 * 用途: UI 流式渲染时,JSONC 未闭合就显示对应类型的 skeleton (而非通用占位)。
 *
 * 多个 talor block 时返回最后一个 (流式中的"当前块")。
 * 未找到返回 null。
 */
export function detectStreamingTalorType(streamingText: string): string | null {
  const all = [...streamingText.matchAll(STREAMING_TYPE_RE)]
  return all.length > 0 ? all[all.length - 1][1] : null
}

// ─── 内部 helpers ──────────────────────────────────────────────────────

function isV1Type(t: string): t is TalorBlockType {
  // v4 协议瘦身:仅保留 UI 装饰类 block + plan(V2)。
  // 已删:pending_continuation (Phase 4a, → request_continuation tool)
  //      pending_confirm (Phase 4b, → tool needsApproval)
  // Phase 5 新增:proposal (通用动作提议,替代 draft_detected)
  return (
    t === 'done' ||
    t === 'need_input' ||
    t === 'blocked' ||
    t === 'warning' ||
    t === 'proposal' ||
    t === 'plan'
  )
}

/**
 * 按 type 校验必填字段。
 *
 * 设计 lenient: 只校验"必填字段类型对",不强求字段顺序、不拒绝额外字段。
 * 选填字段缺失不报错。
 */
function validateBlockFields(type: TalorBlockType, obj: Record<string, unknown>): boolean {
  switch (type) {
    case 'done':
      return typeof obj.summary === 'string' && obj.summary.length > 0
    case 'need_input':
      return typeof obj.question === 'string' && obj.question.length > 0
    case 'blocked':
      return typeof obj.reason === 'string' && obj.reason.length > 0
    case 'warning':
      return typeof obj.message === 'string' && obj.message.length > 0
    case 'proposal':
      return validateProposalFields(obj)
    case 'plan':
      return Array.isArray(obj.steps)
    default:
      return false
  }
}

function validateProposalFields(obj: Record<string, unknown>): boolean {
  if (typeof obj.summary !== 'string' || obj.summary.length === 0) return false
  if (typeof obj.action !== 'object' || obj.action === null || Array.isArray(obj.action))
    return false
  const action = obj.action as Record<string, unknown>
  if (typeof action.label !== 'string' || action.label.length === 0) return false
  if (typeof action.tool !== 'string' || action.tool.length === 0) return false
  if (typeof action.args !== 'object' || action.args === null || Array.isArray(action.args))
    return false
  if (obj.preview !== undefined && typeof obj.preview !== 'string') return false
  if (obj.secondary_actions !== undefined) {
    if (!Array.isArray(obj.secondary_actions)) return false
    for (const sa of obj.secondary_actions) {
      if (typeof sa !== 'object' || sa === null) return false
      const s = sa as Record<string, unknown>
      if (typeof s.label !== 'string' || typeof s.emit !== 'string') return false
    }
  }
  return true
}
