import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { streamText } from 'ai'
import type { SystemModelMessage, UserModelMessage, AssistantModelMessage } from '@ai-sdk/provider-utils'
import { createModel } from '../providers/llm-provider'
import { ConfigStore, type Provider } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { getMainWindow } from '../ipc/window'
import log from 'electron-log'
import type { MessagePart, ImagePart, FilePart } from '../../renderer/types/chat'
import { decodeMessageContent } from '../../renderer/types/chat'
import fs from 'fs/promises'
import mime from 'mime-types'
import { toolRegistry } from '../tools/registry'
import '../tools/builtin'
import { dynamicTool, jsonSchema } from 'ai'

/**
 * 检查 Provider 是否支持视觉（多模态）
 */
function checkVisionSupport(provider: Provider, attachments: Array<{ mime_type: string }>): void {
  // 检查是否有图片附件
  const hasImageAttachment = attachments.some(attachment => 
    SUPPORTED_IMAGE_TYPES.includes(attachment.mime_type)
  )
  
  // 处理向后兼容：如果 supports_vision 字段不存在，默认为 false
  const supportsVision = 'supports_vision' in provider ? provider.supports_vision : false
  
  if (hasImageAttachment && !supportsVision) {
    throw new Error('PROVIDER_NO_VISION')
  }
}

// 验证常量（与 fileHandlers.ts 保持一致）
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
]
const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

/**
 * 验证附件文件
 */
async function validateAttachment(attachment: { path: string; mime_type: string; filename: string; size_bytes: number }): Promise<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }> {
  try {
    // 检查文件是否存在
    await fs.access(attachment.path)
    
    // 获取实际文件信息
    const stats = await fs.stat(attachment.path)
    const actualMimeType = mime.lookup(attachment.path) || 'application/octet-stream'
    
    // 验证文件大小
    if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new Error('FILE_TOO_LARGE')
    }
    
    // 验证文件类型
    if (!SUPPORTED_ATTACHMENT_TYPES.includes(actualMimeType)) {
      throw new Error('UNSUPPORTED_FILE_TYPE')
    }
    
    // 如果是图片，读取为 Base64
    let base64_data: string | undefined
    if (SUPPORTED_IMAGE_TYPES.includes(actualMimeType)) {
      const buffer = await fs.readFile(attachment.path)
      base64_data = `data:${actualMimeType};base64,${buffer.toString('base64')}`
    }
    
    return {
      path: attachment.path,
      mime_type: actualMimeType,
      filename: attachment.filename,
      size_bytes: stats.size,
      base64_data,
    }
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'FILE_TOO_LARGE' || error.message === 'UNSUPPORTED_FILE_TYPE') {
        throw error
      }
      // 文件访问错误
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('FILE_NOT_FOUND')
      }
    }
    throw new Error(`附件验证失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface ActiveStream {
  abortController: AbortController
  messageId: string
}

const activeStreams = new Map<string, ActiveStream>()

function getDefaultProvider(): Provider {
  const providers = ConfigStore.getInstance().get('providers') as Record<string, Provider>
  const defaults = Object.values(providers).filter((p) => p.is_default && p.enabled)
  if (defaults.length > 0) return defaults[0]

  const enabled = Object.values(providers).filter((p) => p.enabled)
  if (enabled.length > 0) return enabled[0]

  throw new Error('No provider available')
}

function decodeParts(content: string): MessagePart[] {
  return decodeMessageContent(content)
}

function toCoreMessages(sessionId: string, userContent: string, attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>): Array<SystemModelMessage | UserModelMessage | AssistantModelMessage> {
  const rows = messageRepo.listBySession(sessionId)
  const messages: Array<SystemModelMessage | UserModelMessage | AssistantModelMessage> = []

  for (const row of rows) {
    if (row.role === 'system') {
      messages.push({ role: 'system', content: row.content } as SystemModelMessage)
    } else if (row.role === 'user') {
      const parts = decodeParts(row.content)
      const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string } | { type: 'file'; data: string; mediaType: string }> = []
      for (const p of parts) {
        if (p.type === 'text') {
          contentParts.push({ type: 'text', text: String(p.content ?? '') })
        } else if (p.type === 'image') {
          contentParts.push({ type: 'image', image: String(p.data ?? '') })
        } else if (p.type === 'file') {
          // FilePart 转换为 AI SDK 格式
          const filePart = p as FilePart
          contentParts.push({ 
            type: 'file', 
            data: `File: ${filePart.filename}`, // 暂时使用占位符
            mediaType: filePart.mime_type 
          })
        }
      }
      const content: string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string } | { type: 'file'; data: string; mediaType: string }> =
        contentParts.length > 0 ? contentParts : row.content
      messages.push({ role: 'user', content } as UserModelMessage)
    } else if (row.role === 'assistant') {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: row.content }] } as AssistantModelMessage)
    }
  }

  // 处理当前消息（可能包含附件）
  const userMessageParts: MessagePart[] = []
  
  // 添加文本内容
  if (userContent.trim()) {
    userMessageParts.push({ type: 'text', content: userContent })
  }

  // 添加附件
  if (attachments && attachments.length > 0) {
    for (const attachment of attachments) {
      if (attachment.mime_type.startsWith('image/') && attachment.base64_data) {
        // 图片附件
        userMessageParts.push({ 
          type: 'image', 
          mime_type: attachment.mime_type, 
          data: attachment.base64_data,
          filename: attachment.filename 
        } as ImagePart)
      } else {
        // 文件附件（非图片）
        userMessageParts.push({ 
          type: 'file', 
          mime_type: attachment.mime_type, 
          filename: attachment.filename,
          size_bytes: attachment.size_bytes,
          path: attachment.path 
        } as FilePart)
      }
    }
  }

  // 将用户消息部分转换为 AI SDK 格式
  const userContentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string } | { type: 'file'; data: string; mediaType: string }> = []
  for (const part of userMessageParts) {
    if (part.type === 'text') {
      userContentParts.push({ type: 'text', text: part.content })
    } else if (part.type === 'image') {
      userContentParts.push({ type: 'image', image: (part as ImagePart).data })
    } else if (part.type === 'file') {
      // 注意：FilePart 需要文件内容，这里暂时使用占位符
      // 实际实现需要读取文件内容
      userContentParts.push({ 
        type: 'file', 
        data: `File: ${(part as FilePart).filename}`, 
        mediaType: (part as FilePart).mime_type 
      })
    }
  }

  const userMessageContent = userContentParts.length > 0 ? userContentParts : userContent
  messages.push({ role: 'user', content: userMessageContent } as UserModelMessage)
  
  return messages
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, params: { session_id: string; content: string; attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }> }) => {
    log.info('[chat:send] invoked, session:', params.session_id, 'content:', params.content.slice(0, 20))
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new Error('No main window')

    const sessionId = params.session_id
    const userContent = params.content.trim()
    const attachments = params.attachments || []
    
    // 验证消息内容
    if (!userContent.trim() && attachments.length === 0) {
      throw new Error('Empty message: 消息内容和附件不能同时为空')
    }

    // 验证附件（如果存在）
    let validatedAttachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }> = []
    if (attachments.length > 0) {
      try {
        // 并行验证所有附件
        const validationPromises = attachments.map(attachment => validateAttachment(attachment))
        validatedAttachments = await Promise.all(validationPromises)
      } catch (error) {
        log.error('[chat:send] attachment validation failed:', error)
        // 直接抛出错误，错误码已在 validateAttachment 中设置
        throw error
      }
    }

    const existing = activeStreams.get(sessionId)
    if (existing) {
      existing.abortController.abort()
      activeStreams.delete(sessionId)
    }

    const messageId = uuidv4()
    const abortController = new AbortController()
    activeStreams.set(sessionId, { abortController, messageId })

    try {
      const provider = getDefaultProvider()
      const session = sessionRepo.getById(sessionId)
      SafeStorageService.getInstance().getApiKey(provider.id)
      
      // 检查 Provider 是否支持视觉（如果有图片附件）
      if (validatedAttachments.length > 0) {
        checkVisionSupport(provider, validatedAttachments)
      }
      
      const model = createModel(provider, session?.model_id)
      const hasWorkspace = !!(session?.workspace && session.workspace.trim() !== '')

      // 构建 tools（如果 workspace 已设置）
      let tools: Record<string, ReturnType<typeof dynamicTool>> | undefined
      if (hasWorkspace) {
        const schemas = toolRegistry.getAllSchemas()
        tools = schemas.reduce((acc, schema) => {
          const toolDef = toolRegistry.getTool(schema.name)
          if (!toolDef) return acc
          acc[schema.name] = dynamicTool({
            description: schema.description,
            inputSchema: jsonSchema(schema.parameters),
            execute: async (input: unknown) => {
              const result = await toolRegistry.execute(schema.name, input, {
                sessionId,
                workspace: session.workspace,
              })
              return result.output ?? null
            },
          })
          return acc
        }, {} as Record<string, ReturnType<typeof dynamicTool>>)
        log.info('[Chat] Tools enabled, workspace:', session.workspace, 'tools:', Object.keys(tools).join(', '))
      }

      const messages = toCoreMessages(sessionId, userContent, validatedAttachments)

      const userMessageId = uuidv4()
      messageRepo.create({
        id: userMessageId,
        session_id: sessionId,
        role: 'user',
        content: userContent
      })
      sessionRepo.touch(sessionId)

      log.info('[Chat] Starting ReAct loop, model:', session?.model_id || 'default', 'tools:', tools ? Object.keys(tools).length : 0)

      let fullText = ''
      let currentMessages = [...messages]
      const maxSteps = 10

      for (let step = 0; step < maxSteps; step++) {
        if (abortController.signal.aborted) break

        log.info(`[Chat] ReAct step ${step + 1}/${maxSteps}`)

        const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []

        const result = streamText({
          model,
          messages: currentMessages,
          tools,
          abortSignal: abortController.signal,
          onChunk({ chunk }) {
            if (chunk.type === 'text-delta') {
              fullText += chunk.text
              mainWindow.webContents.send('chat:stream', {
                session_id: sessionId,
                message_id: messageId,
                delta: chunk.text,
                done: false
              })
            } else if (chunk.type === 'tool-call') {
              stepToolCalls.push({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input,
              })
              mainWindow.webContents.send('chat:tool-call', {
                session_id: sessionId,
                message_id: messageId,
                tool_call_id: chunk.toolCallId,
                tool_name: chunk.toolName,
                input: chunk.input,
              })
            } else if (chunk.type === 'tool-result') {
              mainWindow.webContents.send('chat:tool-result', {
                session_id: sessionId,
                message_id: messageId,
                tool_call_id: chunk.toolCallId,
                tool_name: chunk.toolName,
                result: chunk.output,
              })
            }
          },
          onError({ error }) {
            log.error('[Chat] Stream error:', error)
          }
        })

        await result.consumeStream()

        if (stepToolCalls.length === 0) {
          log.info('[Chat] No tool calls, ReAct loop done')
          break
        }

        const toolResults = await result.toolResults
        log.info(`[Chat] Executed ${stepToolCalls.length} tool calls, got ${toolResults.length} results`)

        currentMessages = [
          ...currentMessages,
          { role: 'assistant' as const, content: stepToolCalls.map(tc => ({
            type: 'tool-call' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: typeof tc.input === 'string' ? (() => { try { return JSON.parse(tc.input) } catch { return tc.input } })() : tc.input,
          }))},
          { role: 'tool' as const, content: toolResults.map(tr => ({
            type: 'tool-result' as const,
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            output: { type: 'text' as const, value: String(tr.output ?? '') },
          }))},
        ]
      }

      messageRepo.create({
        id: messageId,
        session_id: sessionId,
        role: 'assistant',
        content: fullText
      })
      sessionRepo.touch(sessionId)

      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId,
        message_id: messageId,
        delta: '',
        done: true
      })

      return { message_id: messageId }
    } catch (error) {
      log.error('[chat:send] error:', error)
      activeStreams.delete(sessionId)

      if (error instanceof Error && error.name === 'AbortError') {
        mainWindow.webContents.send('chat:stream', {
          session_id: sessionId,
          message_id: messageId,
          delta: '',
          done: true,
          error_code: 'LLM_ERROR',
          error_message: 'Stream aborted'
        })
        return { message_id: messageId }
      }

      const errMsg = error instanceof Error ? error.message : String(error)
      log.error('[Chat] Send error:', errMsg)

       let errorCode = 'LLM_ERROR'
      if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND')) {
        errorCode = 'LLM_CONNECTION_FAILED'
      } else if (errMsg.includes('401') || errMsg.includes('403') || errMsg.includes('API key')) {
        errorCode = 'AUTH_FAILED'
      } else if (errMsg === 'FILE_TOO_LARGE') {
        errorCode = 'FILE_TOO_LARGE'
      } else if (errMsg === 'UNSUPPORTED_FILE_TYPE') {
        errorCode = 'UNSUPPORTED_FILE_TYPE'
      } else if (errMsg === 'FILE_NOT_FOUND') {
        errorCode = 'FILE_NOT_FOUND'
      }

      mainWindow.webContents.send('chat:stream', {
        session_id: sessionId,
        message_id: messageId,
        delta: '',
        done: true,
        error_code: errorCode,
        error_message: errMsg
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
      log.info('[Chat] Aborted stream for session:', sessionId)
    }
  })
}
