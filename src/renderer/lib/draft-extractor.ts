// Renderer-side lightweight parser for crystallizer agent drafts.
//
// Per spec §B.9 decision R1: keep renderer fast — only do regex extraction +
// JSON.parse. No deep validation. The "review" button only needs to know
// "looks like a profile". Final validation happens in the main process when
// `agents:create-from-draft` IPC is invoked.
//
// Mirrors `src/main/agent/draft-extractor.ts` parseAgentDraft logic but
// without zod / AgentProfile validation.

const FENCED_JSON_REGEX = /```json\s*\n([\s\S]+?)\n```/g

export interface RendererDraftResult {
  /** True when at least one ```json``` block parses to a JSON object with an `id` field. */
  detected: boolean
  /** Last successfully parsed object (per AC-007: prefer last valid block). */
  profile?: Record<string, unknown>
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
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { id?: unknown }).id === 'string'
      ) {
        return { detected: true, profile: parsed as Record<string, unknown> }
      }
    } catch {
      // try earlier block
    }
  }
  return { detected: false }
}
