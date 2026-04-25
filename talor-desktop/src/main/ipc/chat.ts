import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { streamText } from 'ai'
import type { SystemModelMessage, UserModelMessage, AssistantModelMessage, ToolModelMessage } from '@ai-sdk/provider-utils'
import { createModel } from '../providers/llm-provider'
import { ConfigStore, type Provider } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo, parseBlocks } from '../repos/session-repo'
import { getMainWindow } from '../ipc/window'
import log from 'electron-log'
import fs from 'fs/promises'
import mime from 'mime-types'
import { toolRegistry } from '../tools/registry'
import '../tools/builtin'
import { dynamicTool, jsonSchema } from 'ai'
import type { ContentBlock } from '@shared/types/message'
import { MAX_TOOL_RESULT_BYTES } from '@shared/types/message'
import { requestToolConfirm, buildInputSummary } from './tool-confirm'

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
  log.info('[Chat] getDefaultProvider, providers count:', Object.keys(providers).length)
  
  const defaults = Object.values(providers).filter((p) => p.is_default && p.enabled)
  if (defaults.length > 0) {
    log.info('[Chat] Using default provider:', defaults[0].id)
    return defaults[0]
  }

  const enabled = Object.values(providers).filter((p) => p.enabled)
  if (enabled.length > 0) {
    const provider = enabled[0]
    log.info('[Chat] Using enabled provider:', provider.id)
    return provider
  }

  log.error('[Chat] No provider available! Providers:', JSON.stringify(providers))
  throw new Error('No provider available')
}

type CoreMessage = SystemModelMessage | UserModelMessage | AssistantModelMessage | ToolModelMessage

// Keep only the last N tool-result rows at full content; older ones get a short summary
const TOOL_RESULT_FULL_WINDOW = 4

function toCoreMessages(sessionId: string): CoreMessage[] {
  const rows = messageRepo.listBySession(sessionId)

  // Index tool rows so we can truncate older ones
  const toolRowIndices: number[] = []
  rows.forEach((r, i) => { if (r.role === 'tool') toolRowIndices.push(i) })
  const oldToolIndices = new Set(toolRowIndices.slice(0, Math.max(0, toolRowIndices.length - TOOL_RESULT_FULL_WINDOW)))

  const messages: CoreMessage[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const blocks = parseBlocks(row.content)

    if (row.role === 'system') {
      const text = blocks.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('\n')
      messages.push({ role: 'system', content: text } as SystemModelMessage)
    } else if (row.role === 'user') {
      const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string } | { type: 'file'; data: string; mediaType: string }> = []
      for (const b of blocks) {
        if (b.type === 'text') {
          contentParts.push({ type: 'text', text: b.text })
        } else if (b.type === 'image') {
          contentParts.push({ type: 'image', image: b.image })
        } else if (b.type === 'file') {
          contentParts.push({ type: 'file', data: `File: ${b.filename}`, mediaType: b.mimeType })
        }
      }
      messages.push({ role: 'user', content: contentParts.length > 0 ? contentParts : '' } as UserModelMessage)
    } else if (row.role === 'assistant') {
      const contentParts: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }> = []
      for (const b of blocks) {
        if (b.type === 'text') {
          contentParts.push({ type: 'text', text: b.text })
        } else if (b.type === 'tool_use') {
          contentParts.push({ type: 'tool-call', toolCallId: b.toolCallId, toolName: b.toolName, args: b.input })
        }
      }
      messages.push({ role: 'assistant', content: contentParts } as AssistantModelMessage)
    } else if (row.role === 'tool') {
      const isOld = oldToolIndices.has(i)
      const resultParts: Array<{ type: 'tool-result'; toolCallId: string; toolName: string; output: { type: 'text'; value: string } }> = []
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const value = isOld
            ? `[已省略旧结果，工具=${b.toolName}，长度=${b.output.length}字符]`
            : b.output
          resultParts.push({ type: 'tool-result', toolCallId: b.toolCallId, toolName: b.toolName, output: { type: 'text', value } })
        }
      }
      messages.push({ role: 'tool', content: resultParts } as unknown as ToolModelMessage)
    }
  }

  return messages
}

function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_TOOL_RESULT_BYTES) return output
  // Truncate to fit within limit
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_TOOL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[截断：原始输出 ${bytes} 字节]`
}

function buildUserBlocks(
  userContent: string,
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>
): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (userContent.trim()) {
    blocks.push({ type: 'text', text: userContent })
  }
  for (const att of attachments) {
    if (att.mime_type.startsWith('image/') && att.base64_data) {
      blocks.push({ type: 'image', image: att.base64_data, mimeType: att.mime_type })
    } else {
      blocks.push({ type: 'file', filename: att.filename, mimeType: att.mime_type, path: att.path })
    }
  }
  return blocks
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

      let tools: Record<string, ReturnType<typeof dynamicTool>> | undefined
      {
        const allToolSchemas = toolRegistry.listAllTools()
        log.info('[Chat] Available tools from registry:', allToolSchemas.map(t => `${t.name} (${t.provider || 'builtin'})`).join(', '))

        if (allToolSchemas.length <= 7) {
          log.warn('[Chat] Only builtin tools found! MCP tools may not be connected yet. Waiting...')
          await new Promise(resolve => setTimeout(resolve, 2000))
          const refreshedSchemas = toolRegistry.listAllTools()
          log.info('[Chat] After wait, tools:', refreshedSchemas.map(t => `${t.name} (${t.provider || 'builtin'})`).join(', '))
        }

        // builtin file tools require workspace; MCP (external) tools are always available
        const finalSchemas = toolRegistry.listAllTools().filter(schema => {
          const isBuiltin = !schema.provider || schema.provider === 'builtin'
          if (isBuiltin && !hasWorkspace) return false
          return true
        })
        tools = finalSchemas.reduce((acc, schema) => {
          const builtinTool = toolRegistry.getTool(schema.name)
          const externalTool = !builtinTool ? toolRegistry.getToolFromExternal(schema.name) : undefined
          
          if (!builtinTool && !externalTool) {
            log.warn('[Chat] Tool not found, skipping:', schema.name)
            return acc
          }
          
          acc[schema.name] = dynamicTool({
            description: schema.description,
            inputSchema: jsonSchema(schema.parameters),
            execute: async (input: unknown, options: { toolCallId?: string }) => {
              const toolDef = toolRegistry.getTool(schema.name)
              const isHighRisk = toolDef?.riskLevel === 'HIGH'

              if (isHighRisk) {
                const toolCallId = options?.toolCallId ?? uuidv4()
                log.info('[Chat] Requesting tool confirm for:', schema.name, toolCallId)
                const confirmed = await requestToolConfirm(mainWindow, {
                  sessionId,
                  messageId,
                  toolCallId,
                  toolName: schema.name,
                  inputSummary: buildInputSummary(schema.name, input),
                  inputFull: input,
                })
                if (!confirmed) {
                  log.info('[Chat] Tool execution rejected/timed out:', schema.name)
                  return '用户拒绝执行'
                }
              }

              try {
                const result = await toolRegistry.execute(schema.name, input, {
                  sessionId,
                  workspace: session?.workspace ?? '',
                })
                if (result.error) {
                  log.error('[Chat] Tool execution error:', result.toolName, result.error)
                }
                return result.output ?? null
              } catch (err) {
                log.error('[Chat] Tool execute exception:', schema.name, err)
                return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
              }
            },
          })
          return acc
        }, {} as Record<string, ReturnType<typeof dynamicTool>>)
        if (Object.keys(tools).length === 0) tools = undefined
        log.info('[Chat] Tools enabled, workspace:', session?.workspace ?? '(none)', 'tools:', Object.keys(tools ?? {}).join(', '))
      }

      // Save user message as ContentBlock[]
      const userMessageId = uuidv4()
      const userBlocks = buildUserBlocks(userContent, validatedAttachments)
      messageRepo.create({
        id: userMessageId,
        session_id: sessionId,
        role: 'user',
        content: userBlocks,
      })
      sessionRepo.touch(sessionId)

      log.info('[Chat] Starting ReAct loop, model:', session?.model_id || 'default', 'tools:', tools ? Object.keys(tools).length : 0)

      let fullText = ''
      let wroteAssistantFinal = false
      const maxSteps = 30

      for (let step = 0; step < maxSteps; step++) {
        if (abortController.signal.aborted) break

        const currentMessages = toCoreMessages(sessionId)
        log.info(`[Chat] ReAct step ${step + 1}/${maxSteps}, messages count: ${currentMessages.length}`)

        const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
        let stepText = ''

        const result = streamText({
          model,
          messages: currentMessages,
          tools,
          abortSignal: abortController.signal,
          onChunk({ chunk }) {
            if (chunk.type === 'text-delta') {
              fullText += chunk.text
              stepText += chunk.text
              if (chunk.text.length > 0) {
                log.info('[Chat] Text delta received:', chunk.text.slice(0, 50))
              }
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
        log.info('[Chat] Stream consumed, tool calls:', stepToolCalls.length, 'fullText so far:', fullText.length)

        if (stepToolCalls.length === 0) {
          // Final text step — only persist if there's actual text content
          log.info('[Chat] No tool calls, ReAct loop done, stepText length:', stepText.length)
          if (stepText) {
            messageRepo.create({
              id: messageId,
              session_id: sessionId,
              role: 'assistant',
              content: [{ type: 'text', text: stepText }],
            })
            sessionRepo.touch(sessionId)
            wroteAssistantFinal = true
          }
          break
        }

        const toolResults = await result.toolResults
        log.info(`[Chat] Executed ${stepToolCalls.length} tool calls, got ${toolResults.length} results`)

        if (toolResults.length === 0) {
          log.error('[Chat] ERROR: Tool calls made but no results returned! Breaking loop.')
          break
        }

        log.info('[Chat] Tool results sample:', toolResults.slice(0, 1).map(tr => ({ toolName: tr.toolName, outputLength: String(tr.output ?? '').length })))

        // Write assistant message with tool_use blocks
        const assistantBlocks: ContentBlock[] = []
        if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
        for (const tc of stepToolCalls) {
          assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
        }
        messageRepo.create({
          id: uuidv4(),
          session_id: sessionId,
          role: 'assistant',
          content: assistantBlocks,
        })

        // Write tool message with tool_result blocks
        const toolBlocks: ContentBlock[] = toolResults.map(tr => ({
          type: 'tool_result' as const,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: truncateOutput(String(tr.output ?? '')),
          isError: false,
        }))
        messageRepo.create({
          id: uuidv4(),
          session_id: sessionId,
          role: 'tool',
          content: toolBlocks,
        })

        log.info('[Chat] Wrote assistant + tool messages to DB for step', step + 1)
      }

      // If loop ended without any final text, do one forced summary step with no tools
      if (!wroteAssistantFinal && fullText.length === 0) {
        log.info('[Chat] ReAct loop complete with no final text — requesting forced summary')
        try {
          const summaryMessages = toCoreMessages(sessionId)
          const summaryResult = streamText({
            model,
            messages: summaryMessages,
            abortSignal: abortController.signal,
          })
          let summaryText = ''
          for await (const chunk of summaryResult.textStream) {
            summaryText += chunk
            mainWindow.webContents.send('chat:stream', {
              session_id: sessionId,
              message_id: messageId,
              delta: chunk,
              done: false,
            })
          }
          if (summaryText.trim()) {
            const summaryBlocks: ContentBlock[] = [{ type: 'text', text: summaryText }]
            messageRepo.create({
              id: uuidv4(),
              session_id: sessionId,
              role: 'assistant',
              content: summaryBlocks,
            })
            log.info('[Chat] Forced summary written, length:', summaryText.length)
          }
        } catch (err) {
          log.error('[Chat] Forced summary failed:', err)
        }
      }

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
