// src/main/chat/attachments.ts —— 业务层（chat 领域）：附件校验、视觉能力检查、消息 blocks 构造
//
// 职责：
//   1. validateAttachment   —— 路径/大小/mime 校验；图片类型读 base64
//   2. checkVisionSupport   —— provider 能力与附件类型匹配校验
//   3. buildUserBlocks      —— 文本 + 附件转 ContentBlock[] 供 DB 存储与下游消费
//
// 允许依赖：shared/*、store/*（Provider 类型）
// 禁止依赖：ipc/*

import fs from 'fs/promises'
import mime from 'mime-types'
import type { UserContent } from 'ai'
import { MAX_INLINE_ATTACHMENT_BYTES } from '../../shared/types/message'
import type { Provider } from '../store/config-store'

/** 单附件最大 50MB。超过这个阈值 base64 编码后会显著撑大 IPC payload 和 DB row size。 */
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024

/** 视觉模型可接收的图片 mime。凡命中此列表的附件，validateAttachment 会就地读取并 base64 编码。 */
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** 文本类文档：就地读 UTF-8 注入 prompt（截断到 MAX_INLINE_ATTACHMENT_BYTES）。 */
const TEXT_DOCUMENT_TYPES = ['text/plain', 'text/markdown', 'application/json', 'text/csv']

/** 二进制文档：读 base64，由 file-capable provider 消费（如 Anthropic PDF input）。 */
const BINARY_DOCUMENT_TYPES = ['application/pdf']

const SUPPORTED_DOCUMENT_TYPES = [...TEXT_DOCUMENT_TYPES, ...BINARY_DOCUMENT_TYPES]

const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

export interface ValidatedAttachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
  /** 图片附件独有：`data:<mime>;base64,<...>`。 */
  base64_data?: string
  /** 文本类文档：预读的 UTF-8 内容（可能被截断）。 */
  text_content?: string
  /** 二进制文档：纯 base64（不含 data URL 前缀）。 */
  doc_base64?: string
}

/**
 * 校验单个附件，返回带真实 mime、真实 size、（若图片）base64 编码的扩展对象。
 *
 * 错误消息采用字符串常量（不带 i18n），上层 classifyLlmError 按原样匹配：
 *   - FILE_NOT_FOUND         路径不存在（fs.access 失败）
 *   - FILE_TOO_LARGE         文件大小 > 50MB
 *   - UNSUPPORTED_FILE_TYPE  mime 不在白名单
 *
 * 注意：信任的是**实际文件**推断的 mime（mime.lookup(path)），不是前端传来的 mime_type，
 * 避免前端误报或攻击者伪造类型。返回值中的 mime_type 字段会被覆盖为推断值。
 */
export async function validateAttachment(att: {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
}): Promise<ValidatedAttachment> {
  try {
    await fs.access(att.path)
  } catch {
    throw new Error('FILE_NOT_FOUND')
  }
  const stats = await fs.stat(att.path)
  const actualMime = mime.lookup(att.path) || 'application/octet-stream'
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) throw new Error('FILE_TOO_LARGE')
  if (!SUPPORTED_ATTACHMENT_TYPES.includes(actualMime)) throw new Error('UNSUPPORTED_FILE_TYPE')

  const result: ValidatedAttachment = {
    ...att,
    mime_type: actualMime,
    size_bytes: stats.size,
  }

  if (SUPPORTED_IMAGE_TYPES.includes(actualMime)) {
    // 图片：base64 data URL，供 vision provider 直接消费
    const buf = await fs.readFile(att.path)
    result.base64_data = `data:${actualMime};base64,${buf.toString('base64')}`
  } else if (TEXT_DOCUMENT_TYPES.includes(actualMime)) {
    // 文本文档：就地读取并可能截断，避免 prompt 里出现"路径+字面量 File: xxx"的假引用
    const buf = await fs.readFile(att.path)
    const byteLen = buf.byteLength
    const readBuf =
      byteLen > MAX_INLINE_ATTACHMENT_BYTES ? buf.subarray(0, MAX_INLINE_ATTACHMENT_BYTES) : buf
    const text = readBuf.toString('utf-8')
    result.text_content =
      byteLen > MAX_INLINE_ATTACHMENT_BYTES
        ? `${text}\n…[truncated: original ${byteLen} bytes, loaded first ${MAX_INLINE_ATTACHMENT_BYTES} bytes. To load the rest, use the read tool on: ${att.path}]`
        : text
  } else if (BINARY_DOCUMENT_TYPES.includes(actualMime)) {
    // PDF：base64（不含前缀），走 AI SDK file part
    const buf = await fs.readFile(att.path)
    result.doc_base64 = buf.toString('base64')
  }

  return result
}

/**
 * 视觉能力前置校验：provider 不支持视觉（supports_vision !== true）但附件含图片时抛 PROVIDER_NO_VISION。
 * 在上游编排中先于任何 LLM 调用执行，避免浪费一次网络请求才发现错误。
 */
export function checkVisionSupport(
  provider: Pick<Provider, 'supports_vision'>,
  attachments: Array<{ mime_type: string }>,
): void {
  const hasImage = attachments.some((a) => SUPPORTED_IMAGE_TYPES.includes(a.mime_type))
  const supportsVision = provider.supports_vision ?? false
  if (hasImage && !supportsVision) throw new Error('PROVIDER_NO_VISION')
}

/**
 * 把用户文本 + 附件转成 SDK UserContent 格式供 DB 存储。
 */
export function buildUserBlocks(content: string, attachments: ValidatedAttachment[]): UserContent {
  const parts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string }
    | { type: 'file'; data: string; mediaType: string }
  > = []
  if (content.trim()) parts.push({ type: 'text', text: content })
  for (const att of attachments) {
    if (att.mime_type.startsWith('image/') && att.base64_data) {
      parts.push({ type: 'image', image: att.base64_data })
    } else if (att.text_content) {
      parts.push({
        type: 'text',
        text: `[Attachment: ${att.filename} · ${att.mime_type}]\n${att.text_content}\n[End of attachment]`,
      })
    } else if (att.doc_base64) {
      parts.push({ type: 'file', data: att.doc_base64, mediaType: att.mime_type })
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts as UserContent
}
