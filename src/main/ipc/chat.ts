// src/main/ipc/chat.ts
import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { ConfigStore, type Provider } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { getMainWindow } from './window'
import log from 'electron-log'
import fs from 'fs/promises'
import mime from 'mime-types'
import { createModel } from '../providers/llm-provider'
import '../tools/builtin'
import type { ContentBlock } from '@shared/types/message'
import { classifyLlmError } from './error-codes'
import { resolveProviderConfig, PromptPipeline } from '../prompt/PromptPipeline'
import { MemoryManager } from '../memory/MemoryManager'
import { buildTools } from '../tools/build-tools'
import { runReactLoop } from '../loop/react-loop'

const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'application/json', 'text/csv',
]
const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

function checkVisionSupport(provider: Provider, attachments: Array<{ mime_type: string }>): void {
  const hasImage = attachments.some(a => SUPPORTED_IMAGE_TYPES.includes(a.mime_type))
  const supportsVision = 'supports_vision' in provider ? provider.supports_vision : false
  if (hasImage && !supportsVision) throw new Error('PROVIDER_NO_VISION')
}

async function validateAttachment(att: {
  path: string; mime_type: string; filename: string; size_bytes: number
}) {
  try {
    await fs.access(att.path)
  } catch {
    throw new Error('FILE_NOT_FOUND')
  }
  const stats = await fs.stat(att.path)
  const actualMime = mime.lookup(att.path) || 'application/octet-stream'
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error('FILE_TOO_LARGE')
  if (!SUPPORTED_ATTACHMENT_TYPES.includes(actualMime)) throw new Error('UNSUPPORTED_FILE_TYPE')
  let base64_data: string | undefined
  if (SUPPORTED_IMAGE_TYPES.includes(actualMime)) {
    const buf = await fs.readFile(att.path)
    base64_data = `data:${actualMime};base64,${buf.toString('base64')}`
  }
  return { ...att, mime_type: actualMime, size_bytes: stats.size, base64_data }
}

function buildUserBlocks(
  content: string,
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>
): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (content.trim()) blocks.push({ type: 'text', text: content })
  for (const att of attachments) {
    if (att.mime_type.startsWith('image/') && att.base64_data) {
      blocks.push({ type: 'image', image: att.base64_data, mimeType: att.mime_type })
    } else {
      blocks.push({ type: 'file', filename: att.filename, mimeType: att.mime_type, path: att.path })
    }
  }
  return blocks
}

function getDefaultProvider(): Provider {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const defaults = Object.values(providers).filter(p => p.is_default && p.enabled)
  if (defaults.length > 0) return defaults[0]
  const enabled = Object.values(providers).filter(p => p.enabled)
  if (enabled.length > 0) return enabled[0]
  throw new Error('No provider available')
}

interface ActiveStream { abortController: AbortController; messageId: string }
const activeStreams = new Map<string, ActiveStream>()

const _memoryManager = new MemoryManager()
const _pipeline = new PromptPipeline(_memoryManager)

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, params: {
    session_id: string
    content: string
    attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
  }) => {
    log.info('[chat:send] session:', params.session_id, 'content:', params.content.slice(0, 20))
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const sessionId = params.session_id
    const userContent = params.content.trim()
    const attachments = params.attachments ?? []

    if (!userContent && attachments.length === 0) throw new Error('Empty message')

    let validatedAttachments: Array<{
      path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string
    }> = []
    if (attachments.length > 0) {
      validatedAttachments = await Promise.all(attachments.map(validateAttachment))
    }

    const existing = activeStreams.get(sessionId)
    if (existing) { existing.abortController.abort(); activeStreams.delete(sessionId) }

    const messageId = uuidv4()
    const abortController = new AbortController()
    activeStreams.set(sessionId, { abortController, messageId })

    try {
      const provider = getDefaultProvider()
      const session = sessionRepo.getById(sessionId)
      SafeStorageService.getInstance().getApiKey(provider.id)
      if (validatedAttachments.length > 0) checkVisionSupport(provider, validatedAttachments)

      const model = createModel(provider, session?.model_id)
      const workspace = session?.workspace ?? ''

      const tools = await buildTools({ sessionId, messageId, workspace, mainWindow })

      messageRepo.create({
        id: uuidv4(),
        session_id: sessionId,
        role: 'user',
        content: buildUserBlocks(userContent, validatedAttachments),
      })
      sessionRepo.touch(sessionId)

      log.info('[chat:send] Starting ReAct loop, model:', session?.model_id ?? 'default',
        'tools:', Object.keys(tools ?? {}).length)

      const maxReactSteps = ConfigStore.getInstance().get('max_react_steps')

      await runReactLoop({
        model,
        tools,
        sessionId,
        messageId,
        userContent,
        mappedAttachments: validatedAttachments.map(a => ({
          name: a.filename,
          mediaType: a.mime_type,
          base64: a.base64_data,
          content: undefined,
        })),
        abortSignal: abortController.signal,
        pipeline: _pipeline,
        provider,
        providerConfig: resolveProviderConfig(provider),
        workspace,
        maxSteps: typeof maxReactSteps === 'number' && maxReactSteps > 0 ? maxReactSteps : undefined,
        callbacks: {
          onTextDelta: (delta) => mainWindow.webContents.send('chat:stream', {
            session_id: sessionId, message_id: messageId, delta, done: false,
          }),
          onToolCall: (toolCallId, toolName, input) => mainWindow.webContents.send('chat:tool-call', {
            session_id: sessionId, message_id: messageId, tool_call_id: toolCallId, tool_name: toolName, input,
          }),
          onToolResult: (toolCallId, toolName, result) => mainWindow.webContents.send('chat:tool-result', {
            session_id: sessionId, message_id: messageId, tool_call_id: toolCallId, tool_name: toolName, result,
          }),
        },
      })

      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId, message_id: messageId, delta: '', done: true,
      })
      return { message_id: messageId }
    } catch (error) {
      log.error('[chat:send] error:', error)

      if (error instanceof Error && error.name === 'AbortError') {
        mainWindow.webContents.send('chat:stream', {
          session_id: sessionId, message_id: messageId, delta: '', done: true,
          error_code: 'LLM_ERROR', error_message: 'Stream aborted',
        })
        return { message_id: messageId }
      }

      const errMsg = error instanceof Error ? error.message : String(error)
      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId, message_id: messageId, delta: '', done: true,
        error_code: classifyLlmError(error),
        error_message: errMsg,
      })
      throw error
    } finally {
      activeStreams.delete(sessionId)
    }
  })

  ipcMain.handle('chat:abort', (_event, sessionId: string) => {
    const stream = activeStreams.get(sessionId)
    if (stream) {
      stream.abortController.abort()
      activeStreams.delete(sessionId)
      log.info('[chat:abort] Aborted session:', sessionId)
    }
  })
}
