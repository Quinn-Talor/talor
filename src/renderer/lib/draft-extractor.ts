// Renderer-side lightweight parser for crystallizer agent drafts.
//
// Schema 1.0: 检查 `schemaVersion === "1.0"` && `identity.id` 是 string。
// 同时保留对老 schema(顶层 id)的兼容检查,作为渐进过渡兜底(LLM 偶尔吐旧格式)。
//
// 主进程 `agents:create-from-draft` IPC 才做完整 validator 校验,
// renderer 只需快速判定"看起来像 profile"以决定是否展示"审阅"按钮。

const FENCED_JSON_REGEX = /```json\s*\n([\s\S]+?)\n```/g

export interface RendererDraftResult {
  /** True 当 JSON 块解析后形态符合 schema 1.0 (含 identity.id) 或老 schema (顶层 id). */
  detected: boolean
  /** Last successfully parsed object (per AC-007: prefer last valid block). */
  profile?: Record<string, unknown>
}

function isSchemaV1Shape(obj: Record<string, unknown>): boolean {
  if (obj.schemaVersion !== '1.0') return false
  const identity = obj.identity as { id?: unknown } | undefined
  return Boolean(identity && typeof identity === 'object' && typeof identity.id === 'string')
}

/**
 * 检测并 unwrap LLM 常见的"包了一层外壳"输出错误。
 * 例: { "agent_profile_draft": { "schemaVersion": "1.0", ... } }
 *      → unwrap 后 → { "schemaVersion": "1.0", ... }
 *
 * 注意: 这是 LLM 输出容错,不是 schema 向后兼容。schema 1.0 仍是唯一标准。
 */
function unwrapIfWrapped(parsed: unknown): Record<string, unknown> | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (isSchemaV1Shape(obj)) return obj

  // 顶层只有一个 key,且 value 是 schema 1.0 形态 → unwrap
  const keys = Object.keys(obj)
  if (keys.length === 1) {
    const inner = obj[keys[0]]
    if (
      typeof inner === 'object' &&
      inner !== null &&
      isSchemaV1Shape(inner as Record<string, unknown>)
    ) {
      return inner as Record<string, unknown>
    }
  }
  return null
}

export function detectDraftInText(text: string): RendererDraftResult {
  const blocks: string[] = []
  let m: RegExpExecArray | null
  FENCED_JSON_REGEX.lastIndex = 0
  while ((m = FENCED_JSON_REGEX.exec(text)) !== null) {
    blocks.push(m[1])
  }
  if (blocks.length === 0) return { detected: false }

  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(blocks[i]) as unknown
      const unwrapped = unwrapIfWrapped(parsed)
      if (unwrapped) {
        return { detected: true, profile: unwrapped }
      }
    } catch {
      // try earlier block
    }
  }
  return { detected: false }
}
