import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import mime from 'mime-types'
import log from 'electron-log'

interface FileStats {
  size: number
  isFile: () => boolean
}

// Import validation constants from renderer types
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

interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
    | 'noResolveAliases'
    | 'treatPackageAsDirectory'
    | 'dontAddToRecent'
  >
}

interface Attachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
}

/**
 * 验证文件是否符合附件要求
 */
function validateFile(filePath: string, stats: FileStats, mimeType: string): void {
  // 检查文件大小
  if (stats.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`FILE_TOO_LARGE: 文件大小 ${stats.size} 字节超过限制 ${MAX_ATTACHMENT_SIZE_BYTES} 字节`)
  }

  // 检查文件类型
  if (!SUPPORTED_ATTACHMENT_TYPES.includes(mimeType)) {
    const supportedTypes = SUPPORTED_ATTACHMENT_TYPES.join(', ')
    throw new Error(`UNSUPPORTED_FILE_TYPE: 文件类型 ${mimeType} 不支持。支持的类型: ${supportedTypes}`)
  }

  // 检查文件是否可访问（通过 stats 已经验证）
  if (!stats.isFile()) {
    throw new Error(`FILE_NOT_FOUND: ${filePath} 不是文件或无法访问`)
  }
}

/**
 * 获取文件信息（MIME 类型、大小等）
 */
async function getFileInfo(filePath: string): Promise<Attachment> {
  try {
    const stats = await fs.stat(filePath)
    const mimeType = mime.lookup(filePath) || 'application/octet-stream'
    const filename = path.basename(filePath)

    // 验证文件
    validateFile(filePath, stats, mimeType)

    return {
      path: filePath,
      mime_type: mimeType,
      filename,
      size_bytes: stats.size,
    }
  } catch (error) {
    log.error(`Failed to get file info for ${filePath}:`, error)
    if (error instanceof Error && error.message.startsWith('FILE_TOO_LARGE:')) {
      throw error // 保留原始错误消息
    }
    if (error instanceof Error && error.message.startsWith('UNSUPPORTED_FILE_TYPE:')) {
      throw error // 保留原始错误消息
    }
    if (error instanceof Error && error.message.startsWith('FILE_NOT_FOUND:')) {
      throw error // 保留原始错误消息
    }
    throw new Error(`无法读取文件信息: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 读取文件并转换为 Base64 data URL
 */
async function readFileAsBase64(filePath: string, mimeType: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath)
    const base64 = buffer.toString('base64')
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    log.error(`Failed to read file as base64 ${filePath}:`, error)
    throw new Error(`无法读取文件: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 获取附件信息（包含验证和 Base64 编码）
 */
async function getValidatedAttachment(filePath: string): Promise<Attachment & { base64_data?: string }> {
  const attachment = await getFileInfo(filePath)
  
  // 如果是图片，读取为 Base64
  let base64_data: string | undefined
  if (SUPPORTED_IMAGE_TYPES.includes(attachment.mime_type)) {
    base64_data = await readFileAsBase64(filePath, attachment.mime_type)
  }

  return {
    ...attachment,
    base64_data,
  }
}

/**
 * 打开文件对话框
 */
export function registerFileHandlers() {
  ipcMain.handle('file:openDialog', async (_, options?: OpenDialogOptions): Promise<string[] | null> => {
    try {
      const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      if (!mainWindow) {
        throw new Error('没有可用的窗口')
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: options?.title || '选择文件',
        defaultPath: options?.defaultPath,
        buttonLabel: options?.buttonLabel || '选择',
        filters: options?.filters || [
          { name: '所有文件', extensions: ['*'] },
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
          { name: '文档', extensions: ['pdf', 'txt', 'md', 'doc', 'docx'] },
          { name: '代码', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'] },
        ],
        properties: options?.properties || ['openFile', 'multiSelections'],
      })

      if (result.canceled) {
        return null
      }

      return result.filePaths
    } catch (error) {
      log.error('Failed to open file dialog:', error)
      throw new Error(`打开文件对话框失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * 获取文件附件信息（批量）
   */
  ipcMain.handle('file:getAttachments', async (_, filePaths: string[]): Promise<Attachment[]> => {
    try {
      const attachments: Attachment[] = []
      
      for (const filePath of filePaths) {
        try {
          const attachment = await getFileInfo(filePath)
          attachments.push(attachment)
        } catch (error) {
          log.warn(`Skipping file ${filePath}:`, error)
        }
      }

      return attachments
    } catch (error) {
      log.error('Failed to get attachments:', error)
      throw new Error(`获取文件附件信息失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * 获取验证后的附件信息（包含 Base64 编码）
   */
  ipcMain.handle('file:getValidatedAttachments', async (_, filePaths: string[]): Promise<(Attachment & { base64_data?: string })[]> => {
    try {
      const attachments: (Attachment & { base64_data?: string })[] = []
      
      for (const filePath of filePaths) {
        try {
          const attachment = await getValidatedAttachment(filePath)
          attachments.push(attachment)
        } catch (error) {
          log.error(`Failed to validate attachment ${filePath}:`, error)
          throw error // 验证失败时抛出错误，不跳过
        }
      }

      return attachments
    } catch (error) {
      log.error('Failed to get validated attachments:', error)
      throw new Error(`获取验证附件信息失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * 读取文件内容（用于文本文件预览）
   */
  ipcMain.handle('file:readText', async (_, filePath: string, maxBytes = 1024 * 10): Promise<string> => {
    try {
      const stats = await fs.stat(filePath)
      if (stats.size > maxBytes) {
        throw new Error(`文件过大（${stats.size} 字节），最大支持 ${maxBytes} 字节`)
      }

      const content = await fs.readFile(filePath, 'utf-8')
      return content
    } catch (error) {
      log.error(`Failed to read text file ${filePath}:`, error)
      throw new Error(`读取文件失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * 读取图片文件为 base64（用于图片预览）
   */
  ipcMain.handle('file:readImageAsBase64', async (_, filePath: string): Promise<string> => {
    try {
      const buffer = await fs.readFile(filePath)
      const mimeType = mime.lookup(filePath) || 'image/png'
      const base64 = buffer.toString('base64')
      return `data:${mimeType};base64,${base64}`
    } catch (error) {
      log.error(`Failed to read image file ${filePath}:`, error)
      throw new Error(`读取图片失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  /**
   * 检查文件是否可访问
   */
  ipcMain.handle('file:checkAccess', async (_, filePath: string): Promise<boolean> => {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  })

  log.info('File handlers registered')
}