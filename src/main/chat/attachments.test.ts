import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { mockStat, mockAccess, mockReadFile, mockLookup } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
  mockLookup: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  default: { stat: mockStat, access: mockAccess, readFile: mockReadFile },
  stat: mockStat, access: mockAccess, readFile: mockReadFile,
}))

vi.mock('mime-types', () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}))

import {
  validateAttachment,
  buildUserBlocks,
  checkVisionSupport,
} from './attachments'

function baseAtt(overrides: Record<string, unknown> = {}) {
  return {
    path: '/tmp/a.png',
    mime_type: 'image/png',
    filename: 'a.png',
    size_bytes: 1000,
    ...overrides,
  }
}

describe('validateAttachment', () => {
  beforeEach(() => {
    mockStat.mockReset(); mockAccess.mockReset()
    mockReadFile.mockReset(); mockLookup.mockReset()
  })

  it('路径不存在时抛 FILE_NOT_FOUND', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'))
    await expect(validateAttachment(baseAtt())).rejects.toThrow('FILE_NOT_FOUND')
  })

  it('文件大小超限时抛 FILE_TOO_LARGE', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 51 * 1024 * 1024 })
    mockLookup.mockReturnValue('image/png')
    await expect(validateAttachment(baseAtt())).rejects.toThrow('FILE_TOO_LARGE')
  })

  it('不支持的 mime type 抛 UNSUPPORTED_FILE_TYPE', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('application/x-zip')
    await expect(validateAttachment(baseAtt())).rejects.toThrow('UNSUPPORTED_FILE_TYPE')
  })

  it('图片类型会读文件转 base64', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('image/png')
    mockReadFile.mockResolvedValue(Buffer.from('fake'))
    const out = await validateAttachment(baseAtt())
    expect(out.base64_data).toMatch(/^data:image\/png;base64,/)
  })

  it('非图片类型不读文件', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('application/pdf')
    const out = await validateAttachment(baseAtt({ mime_type: 'application/pdf', filename: 'a.pdf' }))
    expect(out.base64_data).toBeUndefined()
    expect(mockReadFile).not.toHaveBeenCalled()
  })
})

describe('checkVisionSupport', () => {
  const visionProvider = { supports_vision: true } as Parameters<typeof checkVisionSupport>[0]
  const nonVisionProvider = { supports_vision: false } as Parameters<typeof checkVisionSupport>[0]

  it('provider 不支持视觉但附件含图片时抛 PROVIDER_NO_VISION', () => {
    expect(() => checkVisionSupport(nonVisionProvider, [{ mime_type: 'image/png' }]))
      .toThrow('PROVIDER_NO_VISION')
  })

  it('provider 支持视觉时通过', () => {
    expect(() => checkVisionSupport(visionProvider, [{ mime_type: 'image/png' }])).not.toThrow()
  })

  it('无图片附件时通过', () => {
    expect(() => checkVisionSupport(nonVisionProvider, [{ mime_type: 'application/pdf' }])).not.toThrow()
  })
})

describe('buildUserBlocks', () => {
  it('纯文本返回一个 text block', () => {
    const blocks = buildUserBlocks('hello', [])
    expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('空文本 + 无附件返回空数组', () => {
    expect(buildUserBlocks('', [])).toEqual([])
  })

  it('图片附件转 image block', () => {
    const blocks = buildUserBlocks('', [{
      path: '/p/a.png', mime_type: 'image/png', filename: 'a.png',
      size_bytes: 1, base64_data: 'data:image/png;base64,ZmFrZQ==',
    }])
    expect(blocks[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
  })

  it('文档附件转 file block', () => {
    const blocks = buildUserBlocks('', [{
      path: '/p/a.pdf', mime_type: 'application/pdf', filename: 'a.pdf', size_bytes: 1,
    }])
    expect(blocks[0]).toMatchObject({ type: 'file', filename: 'a.pdf', mimeType: 'application/pdf' })
  })
})
