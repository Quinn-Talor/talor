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
  stat: mockStat,
  access: mockAccess,
  readFile: mockReadFile,
}))

vi.mock('mime-types', () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}))

import { validateAttachment, buildUserBlocks, checkVisionSupport } from './attachments'

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
    mockStat.mockReset()
    mockAccess.mockReset()
    mockReadFile.mockReset()
    mockLookup.mockReset()
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

  it('PDF 读 base64 到 doc_base64，不写 data URL 前缀', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 1000 })
    mockLookup.mockReturnValue('application/pdf')
    mockReadFile.mockResolvedValue(Buffer.from('PDFDATA'))
    const out = await validateAttachment(
      baseAtt({ mime_type: 'application/pdf', filename: 'a.pdf' }),
    )
    expect(out.base64_data).toBeUndefined()
    expect(out.doc_base64).toBe(Buffer.from('PDFDATA').toString('base64'))
  })

  it('文本文档就地读 UTF-8 到 text_content', async () => {
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: 10 })
    mockLookup.mockReturnValue('text/markdown')
    mockReadFile.mockResolvedValue(Buffer.from('# 标题\n内容', 'utf-8'))
    const out = await validateAttachment(baseAtt({ mime_type: 'text/markdown', filename: 'a.md' }))
    expect(out.text_content).toBe('# 标题\n内容')
    expect(out.doc_base64).toBeUndefined()
  })

  it('文本文档超限时截断并附说明', async () => {
    const bigContent = 'a'.repeat(200 * 1024)
    mockAccess.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ size: bigContent.length })
    mockLookup.mockReturnValue('text/plain')
    mockReadFile.mockResolvedValue(Buffer.from(bigContent, 'utf-8'))
    const out = await validateAttachment(baseAtt({ mime_type: 'text/plain', filename: 'big.txt' }))
    expect(out.text_content).toContain('…[truncated: original')
    expect(out.text_content!.length).toBeLessThan(bigContent.length)
  })
})

describe('checkVisionSupport', () => {
  const visionProvider = { supports_vision: true } as Parameters<typeof checkVisionSupport>[0]
  const nonVisionProvider = { supports_vision: false } as Parameters<typeof checkVisionSupport>[0]

  it('provider 不支持视觉但附件含图片时抛 PROVIDER_NO_VISION', () => {
    expect(() => checkVisionSupport(nonVisionProvider, [{ mime_type: 'image/png' }])).toThrow(
      'PROVIDER_NO_VISION',
    )
  })

  it('provider 支持视觉时通过', () => {
    expect(() => checkVisionSupport(visionProvider, [{ mime_type: 'image/png' }])).not.toThrow()
  })

  it('无图片附件时通过', () => {
    expect(() =>
      checkVisionSupport(nonVisionProvider, [{ mime_type: 'application/pdf' }]),
    ).not.toThrow()
  })
})

describe('buildUserBlocks', () => {
  it('纯文本返回 string', () => {
    const result = buildUserBlocks('hello', [])
    expect(result).toBe('hello')
  })

  it('空文本 + 无附件返回空数组', () => {
    expect(buildUserBlocks('', [])).toEqual([])
  })

  it('图片附件转 SDK image part', () => {
    const result = buildUserBlocks('', [
      {
        path: '/p/a.png',
        mime_type: 'image/png',
        filename: 'a.png',
        size_bytes: 1,
        base64_data: 'data:image/png;base64,ZmFrZQ==',
      },
    ])
    expect((result as Array<unknown>)[0]).toMatchObject({
      type: 'image',
      image: 'data:image/png;base64,ZmFrZQ==',
    })
  })

  it('文档附件转 SDK text part（inline text_content）', () => {
    const result = buildUserBlocks('', [
      {
        path: '/p/a.md',
        mime_type: 'text/markdown',
        filename: 'a.md',
        size_bytes: 10,
        text_content: '# hello',
      },
    ])
    expect(typeof result).toBe('string')
    expect(result as string).toContain('# hello')
  })

  it('PDF 附件转 SDK file part', () => {
    const result = buildUserBlocks('', [
      {
        path: '/p/a.pdf',
        mime_type: 'application/pdf',
        filename: 'a.pdf',
        size_bytes: 1,
        doc_base64: 'UERGU0lH',
      },
    ])
    expect((result as Array<unknown>)[0]).toMatchObject({
      type: 'file',
      data: 'UERGU0lH',
      mediaType: 'application/pdf',
    })
  })
})
