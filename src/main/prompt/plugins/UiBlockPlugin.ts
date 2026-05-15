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

const BLOCK_PROTOCOL = `# UI blocks — emit when interaction or terminal state is needed

You can emit structured UI blocks alongside your prose. **Markdown is the default**;
use blocks sparingly, only when one of the cases below applies. Each block is a
fenced code block with language \`talor\`:

\`\`\`talor
{"type": "<block-type>", ...}
\`\`\`

## need_input — ask the user to pick from 2-5 discrete options

Use when you need a clear choice (not open-ended). Don't use for confirming an action
you've already prepared — that's \`proposal\`.

\`\`\`talor
{
  "type": "need_input",
  "question": "Which time slot works?",
  "choices": ["Mon 10:30", "Tue 15:00", "Let me check others"],
  "reason": "Each slot has different conflicts."
}
\`\`\`

## proposal — propose a one-click action the user confirms

Use when you've prepared something the user should review and execute with one click
(send email, save config, create event, ...). The \`action.tool\` MUST be a real tool
name available to you in this turn; \`action.args\` MUST satisfy that tool's schema.
The system validates tool name + args + permission before invoking — if any check
fails you'll be told and can revise.

\`\`\`talor
{
  "type": "proposal",
  "summary": "Email draft to wang@acme.com — Re: Q4 renewal",
  "preview": "Hi Wang,\\n\\nRe: your two questions...",
  "action": {
    "label": "Send",
    "tool": "gmail.send_draft",
    "args": {"draft_id": "abc-123"}
  },
  "secondary_actions": [
    { "label": "Edit", "emit": "I want to revise it" },
    { "label": "Rewrite", "emit": "Use a different tone" }
  ]
}
\`\`\`

\`secondary_actions[].emit\` strings are sent back as the user's next message — use
them to offer "rewrite this differently" type follow-ups without forcing the user
to type.

## done — terminal block at end of turn (no tool call)

\`\`\`talor
{"type": "done", "summary": "Verified all 24 tests pass."}
\`\`\`

## blocked — task cannot continue without external change

\`\`\`talor
{
  "type": "blocked",
  "reason": "Need read permission on ~/.ssh/config.",
  "can_retry": true,
  "retry_hint": "Add ~/.ssh/config to allowlist in Settings → Permissions, then say 'retry'."
}
\`\`\`

## warning — alert user mid-flow, non-blocking

\`\`\`talor
{"type": "warning", "message": "Detected rm -rf, intercepted.", "severity": "high"}
\`\`\`

Severity is one of \`low\` / \`medium\` / \`high\` (default \`medium\`).

## When NOT to use blocks

- Don't wrap normal prose in a block. If you're just answering, prose is correct.
- Don't \`done\` a turn that has tool calls — \`done\` is for end-of-turn after all
  tool work has finished.
- Don't fabricate tool names in \`proposal.action.tool\`. If you don't have the tool,
  ask the user in prose instead.`

export class UiBlockPlugin implements PromptPlugin {
  name = 'UiBlockPlugin'

  async build(_ctx: PipelineContext): Promise<PluginResult> {
    return {
      messages: [{ role: 'system', content: BLOCK_PROTOCOL }],
      tools: [],
      tokenEstimate: estimate(BLOCK_PROTOCOL),
    }
  }
}
