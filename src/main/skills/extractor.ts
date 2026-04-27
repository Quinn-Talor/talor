import type { ContentBlock } from '@shared/types/message'

interface MessageWithBlocks {
  role: string
  content: ContentBlock[]
}

export function extractActivatedSkills(messages: MessageWithBlocks[]): string[] {
  const names: string[] = []

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const block of msg.content) {
      if (block.type === 'tool_use' && block.toolName === 'skill') {
        const inputObj = block.input as Record<string, unknown> | null
        const skillName = typeof inputObj?.name === 'string' ? inputObj.name : ''
        if (skillName && !names.includes(skillName)) {
          names.push(skillName)
        }
      }
    }
  }

  return names
}
