// Renderer-side lightweight parser for crystallizer agent drafts.
//
// Schema 2.0: 检查顶层 `id` 字段为 string（快速判定"看起来像 profile"）。
// 主进程 `agents:create-from-draft` IPC 才做完整 validator 校验。
// Renderer 只需快速判定以决定是否展示"审阅"按钮。

const FENCED_JSON_REGEX = /```json\s*\n([\s\S]+?)\n```/g

export interface RendererDraftResult {
  /** True 当 JSON 块解析后含顶层 `id` 字符串字段（看起来像 agent profile）。 */
  detected: boolean
  /** Last successfully parsed object (per AC-007: prefer last valid block). */
  profile?: Record<string, unknown>
}

function isAgentProfileShape(obj: Record<string, unknown>): boolean {
  // v2.0: 顶层 id 字段 (string) 是最小必要条件
  return typeof obj.id === 'string' && obj.id.length > 0
}

/**
 * 检测并 unwrap LLM 常见的"包了一层外壳"输出错误。
 * 例: { "agent_profile_draft": { "id": "...", ... } }
 *      → unwrap 后 → { "id": "...", ... }
 *
 * 注意: 这是 LLM 输出容错,不是 schema 验证。完整校验在主进程 IPC 层。
 */
function unwrapIfWrapped(parsed: unknown): Record<string, unknown> | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (isAgentProfileShape(obj)) return obj

  // 顶层只有一个 key,且 value 形态符合 → unwrap
  const keys = Object.keys(obj)
  if (keys.length === 1) {
    const inner = obj[keys[0]]
    if (
      typeof inner === 'object' &&
      inner !== null &&
      isAgentProfileShape(inner as Record<string, unknown>)
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
