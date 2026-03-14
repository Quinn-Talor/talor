import { sessionRepository } from './db/sessionRepository'
import { providerRepository } from './db/providerRepository'
import { agentRepository } from './db/agentRepository'
import type { Session, Message, ToolCall } from './types'

export interface ChatExecutor {
  execute(params: {
    sessionId: string
    prompt: string
    onMessage: (message: Message) => void
    onToolCall?: (toolCall: ToolCall) => void
  }): Promise<void>
}

export function createChatExecutor(): ChatExecutor {
  return {
    async execute({ sessionId, prompt, onMessage, onToolCall }) {
      const session = sessionRepository.findById(sessionId)
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`)
      }

      const provider = providerRepository.findById('ollama')
      if (!provider) {
        throw new Error('No provider configured')
      }

      const agent = agentRepository.findById(session.agentId || 'build')
      if (!agent) {
        throw new Error(`Agent not found: ${session.agentId}`)
      }

      const userMessage: Message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: prompt,
        timestamp: Date.now()
      }
      sessionRepository.addMessage(sessionId, userMessage)
      onMessage(userMessage)

      const assistantMessage: Message = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: []
      }
      sessionRepository.addMessage(sessionId, assistantMessage)
      onMessage(assistantMessage)
    }
  }
}
