import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { estimate } from '../../memory/types'

export class UserMessagePlugin implements PromptPlugin {
  name = 'UserMessagePlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const msg = ctx.currentMessage
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mimeType?: string }
      | { type: 'file'; data: string; mediaType: string }
    > = []

    content.push({ type: 'text', text: msg.text })

    for (const att of (msg.attachments ?? [])) {
      if (att.mediaType?.startsWith('image/')) {
        content.push({ type: 'image', image: att.base64 ?? '', mimeType: att.mediaType })
      } else if (att.mediaType) {
        content.push({ type: 'file', data: att.base64 ?? att.content ?? '', mediaType: att.mediaType })
      } else {
        content.push({ type: 'text', text: `[文件: ${att.name}]\n${att.content ?? ''}` })
      }
    }

    const attachmentTokens = (msg.attachments ?? []).reduce((sum, a) => {
      if (a.mediaType?.startsWith('image/')) return sum + 85
      return sum + estimate(a.content ?? '')
    }, 0)

    return {
      messages: [{ role: 'user', content }],
      tools: [],
      tokenEstimate: estimate(msg.text) + attachmentTokens,
    }
  }
}
