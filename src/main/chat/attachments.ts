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
import type { ContentBlock } from '@shared/types/message'
import type { Provider } from '../store/config-store'

/** 单附件最大 50MB。超过这个阈值 base64 编码后会显著撑大 IPC payload 和 DB row size。 */
const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024

/** 视觉模型可接收的图片 mime。凡命中此列表的附件，validateAttachment 会就地读取并 base64 编码。 */
const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** 非图片文档类型。这些类型不做 base64，仅以 path 引用传给下游（由模型自行读取）。 */
const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf', 'text/plain', 'text/markdown', 'application/json', 'text/csv',
]

const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]

export interface ValidatedAttachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
  /** 图片附件独有：`data:<mime>;base64,<...>`。非图片类型为 undefined。 */
  base64_data?: string
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
  path: string; mime_type: string; filename: string; size_bytes: number
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

  // 图片才读文件做 base64：文档类走"路径引用"通道，避免大文件占用进程内存。
  let base64_data: string | undefined
  if (SUPPORTED_IMAGE_TYPES.includes(actualMime)) {
    const buf = await fs.readFile(att.path)
    base64_data = `data:${actualMime};base64,${buf.toString('base64')}`
  }
  return { ...att, mime_type: actualMime, size_bytes: stats.size, base64_data }
}

/**
 * 视觉能力前置校验：provider 不支持视觉（supports_vision !== true）但附件含图片时抛 PROVIDER_NO_VISION。
 * 在上游编排中先于任何 LLM 调用执行，避免浪费一次网络请求才发现错误。
 */
export function checkVisionSupport(
  provider: Pick<Provider, 'supports_vision'>,
  attachments: Array<{ mime_type: string }>,
): void {
  const hasImage = attachments.some(a => SUPPORTED_IMAGE_TYPES.includes(a.mime_type))
  const supportsVision = provider.supports_vision ?? false
  if (hasImage && !supportsVision) throw new Error('PROVIDER_NO_VISION')
}

/**
 * 把用户文本 + 附件转成 ContentBlock[] 供 DB 存储与下游消费。
 *
 * 规则：
 *   - trim 非空 → 追加 `text` block
 *   - 图片且有 base64_data → 追加 `image` block（下游直接塞给视觉模型）
 *   - 其它 → 追加 `file` block（仅保留 path 引用，由内建 read 工具或模型读取）
 *
 * 空 text + 空 attachments 返回空数组；调用方应确保至少有其一，否则上游 orchestrator 会拦截。
 */
export function buildUserBlocks(
  content: string,
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number; base64_data?: string }>,
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
