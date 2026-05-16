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
  ask the user in prose instead.

## Markdown formatting reminders

- **Tables** must include the header separator row, e.g.:
  \`\`\`
  | Header 1 | Header 2 |
  |----------|----------|
  | cell     | cell     |
  \`\`\`
  Without the \`|----|----|\` row it renders as plain pipe-separated text, not a table.
- **Lists**: use \`-\` for bullets (one per line) or \`1.\` for ordered. Don't use
  pipe-separated single-line "tables" as a substitute for lists.
- **Code blocks**: use fenced \`\`\`lang for syntax highlighting. Inline \`code\` is single
  backticks.
- **Line breaks**: single newlines render as soft breaks (GitHub / ChatGPT semantics).
  For paragraph breaks use a blank line.
- **DO NOT compose ASCII / Box-drawing flow charts inline**. Characters like
  \`│ ▼ → ┌ └ ├ ─\` strung together with \`|\` separators on one line render as
  unreadable line-wrapped soup. If you want to show a sequence/flow, choose ONE:
    1. **Numbered list** — one step per line:
       \`\`\`
       1. User triggers event
       2. user_campaign_event written
       3. event_type matched
       \`\`\`
    2. **Fenced code block with newlines preserved**:
       \`\`\`text
       user 触发事件
         ↓
       user_campaign_event 写入
         ↓
       user_campaign 创建
       \`\`\`
    3. **Mermaid block** (the UI renders it as an SVG diagram):
       \`\`\`mermaid
       flowchart TD
         A[User triggers event] --> B[user_campaign_event written]
         B --> C[user_campaign created]
       \`\`\`
  Never put more than ~3 \`│\` / \`|\` chars on a single line outside an actual
  GFM table. Long inline sequences ALWAYS wrap into illegible paragraph soup.`

export class UiBlockPlugin implements PromptPlugin {
  name = 'UiBlockPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    // Opt-out: agents with disableUiBlocks=true (e.g. JSON-API agents with their
    // own output protocol) skip the block vocabulary injection. The renderer
    // still parses+displays any block the agent does emit — this only controls
    // whether we encourage block usage via the system prompt.
    if (ctx.agent?.profile?.preferences?.disableUiBlocks) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    return {
      messages: [{ role: 'system', content: BLOCK_PROTOCOL }],
      tools: [],
      tokenEstimate: estimate(BLOCK_PROTOCOL),
    }
  }
}
