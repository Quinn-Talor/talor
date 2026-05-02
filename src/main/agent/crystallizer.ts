// src/main/agent/crystallizer.ts — 业务层：沉淀引导 + 依赖提取
//
// 从 session 消息历史中提取两类依赖（tools / skills）。
// Crystallizer 平台 Agent 的 profile 已在 agent-manager.ts 中硬编码。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*

// Uses SDK-format content parts from DB

const ALWAYS_AVAILABLE_TOOLS = new Set(['read', 'ls', 'glob', 'grep', 'skill'])

export interface ExtractedDependencies {
  tools: string[]
  skills: string[]
}

export function extractDependenciesFromMessages(
  messages: Array<{
    role: string
    content: Array<{ type: string; toolName?: string; input?: unknown; output?: unknown }>
  }>,
): ExtractedDependencies {
  const tools = new Set<string>()
  const skills = new Set<string>()

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool-call') {
        const toolName = block.toolName ?? ''
        if (toolName === 'skill') continue
        if (!ALWAYS_AVAILABLE_TOOLS.has(toolName)) {
          tools.add(toolName)
        }
      }

      if (block.type === 'tool-result' && block.toolName === 'skill') {
        const rawOutput = block.output as { type: string; value: string } | string | undefined
        const output =
          typeof rawOutput === 'string'
            ? rawOutput
            : ((rawOutput as { value?: string })?.value ?? '')
        const match = output.match(/\[SKILL:(\S+) activated\]/)
        if (match) {
          skills.add(match[1])
        }
      }
    }
  }

  return {
    tools: Array.from(tools),
    skills: Array.from(skills),
  }
}
