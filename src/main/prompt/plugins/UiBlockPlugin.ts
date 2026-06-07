// src/main/prompt/plugins/UiBlockPlugin.ts —— 业务层(prompt): UI Block 协议注入
//
// 在 system prompt 末尾追加 Talor Block 协议说明，教 LLM 何时用什么 block
// 以及如何填字段。LLM 在 prose 中用 ```talor fenced JSON 形式 emit block。
//
// 5 个 block: done · need_input · blocked · warning · proposal
//   - done / blocked / warning / need_input 已在 SystemPlugin 的行为宪法
//     (Principle 14) 简略提及; 此 plugin 提供 schema-level 完整文档 + proposal
//     这个新增 block (Phase 2 加的, 取代 v3 时期的 draft_detected)
//   - 渲染策略详见 spec §11
//
// 允许依赖: prompt/types
// 禁止依赖: ipc/*

import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { estimate } from '../../memory/types'

const BLOCK_PROTOCOL = `# UI blocks (talor protocol)

Default to markdown prose. To emit a structured block, place ONE at turn end
(no tool call this turn) as the LAST element, fenced with language \`talor\`:

\`\`\`talor
{"type":"<type>", ...}
\`\`\`

## 5 block types

| type | when | shape |
|---|---|---|
| done | task complete, no follow-up | \`{summary, result?}\` |
| need_input | need user to PICK from 2-5 discrete options | \`{question, choices, reason?}\` |
| blocked | cannot continue without external change | \`{reason, can_retry?, retry_hint?}\` |
| warning | mid-flow alert, non-blocking | \`{message, severity: low\\|medium\\|high}\` |
| proposal | user-confirmable composite action | \`{summary, preview?, action:{label,tool,args}, secondary_actions?}\` |

## Examples (one-liners)

\`\`\`talor
{"type":"done","summary":"Verified 24/24 tests pass."}
\`\`\`

\`\`\`talor
{"type":"need_input","question":"Which slot?","choices":["Mon 10:30","Tue 15:00"],"reason":"Each has different conflicts."}
\`\`\`

\`\`\`talor
{"type":"blocked","reason":"Need read permission on ~/.ssh/config.","can_retry":true,"retry_hint":"Add to Settings → Permissions, then say 'retry'."}
\`\`\`

\`\`\`talor
{"type":"warning","message":"Detected rm -rf, intercepted.","severity":"high"}
\`\`\`

\`\`\`talor
{"type":"proposal","summary":"Send email to wang@acme.com","preview":"Hi Wang,\\n\\nRe: your two questions...","action":{"label":"Send","tool":"gmail.send_draft","args":{"draft_id":"abc"}},"secondary_actions":[{"label":"Edit","emit":"revise the tone"}]}
\`\`\`

\`action.tool\` MUST be a tool registered for this turn (no hallucinations — UI
rejects unknown tool names before reaching the LLM). \`secondary_actions[i].emit\`
becomes the user's next message; use for "rewrite/change tone" follow-ups.

## Rules

- ONE block per turn, at end, no tool call this turn.
- Never wrap normal prose in a block. Markdown is the default.
- Never fabricate tool names in \`proposal.action.tool\`. If you lack the tool, ask in prose.

## Markdown formatting

- Tables MUST include the \`|---|---|\` separator row; missing it = pipe-text soup.
- Lists: \`- item\` or \`1. item\`, one per line. Never fake tables with single-line pipes.
- Flow / sequence diagrams: use numbered list, fenced \`\`\`text block, OR \`\`\`mermaid block.
  Never inline \`│ ▼ → ┌ └ ├ ─\` with \`|\` separators — always wraps into illegible
  paragraph soup. >3 pipe chars on one line outside a GFM table = bug.
- Soft break = single newline. Paragraph = blank line.`

export class UiBlockPlugin implements PromptPlugin {
  name = 'UiBlockPlugin'

  async build(_ctx: PipelineContext): Promise<PluginResult> {
    // 极简: 总是注入 block 词典(disableUiBlocks 已从 schema 删除)
    return {
      messages: [{ role: 'system', content: BLOCK_PROTOCOL }],
      tools: [],
      tokenEstimate: estimate(BLOCK_PROTOCOL),
    }
  }
}
