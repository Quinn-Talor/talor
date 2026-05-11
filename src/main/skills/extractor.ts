interface MessageWithParts {
  role: string
  content: Array<{ type: string; toolName?: string; input?: unknown }>
}

export function extractActivatedSkills(messages: MessageWithParts[]): string[] {
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
