import type { Attachment } from '../types/chat'

interface AttachmentPreviewProps {
  attachment: Attachment & { base64_data?: string }
  onRemove?: () => void
  compact?: boolean
}

export function AttachmentPreview({ attachment, onRemove, compact = false }: AttachmentPreviewProps) {
  const isImage = attachment.mime_type.startsWith('image/')
  const isText = attachment.mime_type.startsWith('text/') || attachment.mime_type.includes('document')
  const isPdf = attachment.mime_type === 'application/pdf'
  const isCode = attachment.mime_type.includes('javascript') || 
                 attachment.mime_type.includes('typescript') ||
                 attachment.mime_type.includes('python') ||
                 attachment.mime_type.includes('java') ||
                 attachment.mime_type.includes('c++') ||
                 attachment.mime_type.includes('go') ||
                 attachment.mime_type.includes('rust')

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '未知大小'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileIcon = () => {
    if (isImage) return '🖼️'
    if (isPdf) return '📄'
    if (isText) return '📝'
    if (isCode) return '💻'
    return '📎'
  }

  const getFileTypeColor = () => {
    if (isImage) return 'bg-blue-50 border-blue-100 text-blue-700'
    if (isPdf) return 'bg-red-50 border-red-100 text-red-700'
    if (isText) return 'bg-green-50 border-green-100 text-green-700'
    if (isCode) return 'bg-purple-50 border-purple-100 text-purple-700'
    return 'bg-gray-50 border-gray-100 text-gray-700'
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${getFileTypeColor()} rounded-lg px-3 py-2 text-sm border`}>
        <span className="text-lg">{getFileIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate max-w-[180px]">{attachment.filename}</div>
          <div className="text-xs opacity-70">{formatFileSize(attachment.size_bytes)}</div>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded p-1 transition-colors"
            title="移除"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`flex items-start gap-3 ${getFileTypeColor()} rounded-xl p-4 border`}>
      <div className="text-2xl">{getFileIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base mb-1 truncate">{attachment.filename}</div>
        <div className="text-sm opacity-80 mb-2">
          <div className="flex items-center gap-4">
            <span>类型: {attachment.mime_type}</span>
            <span>大小: {formatFileSize(attachment.size_bytes)}</span>
          </div>
        </div>
        {isImage && (
          <div className="mt-2">
            <div className="text-sm font-medium mb-1">图片预览:</div>
            <div className="bg-white border border-gray-200 rounded-lg p-2 inline-block">
              {attachment.base64_data ? (
                <img 
                  src={attachment.base64_data} 
                  alt={attachment.filename}
                  className="w-32 h-32 object-contain rounded"
                  onError={(e) => {
                    // 图片加载失败时显示占位符
                    const target = e.target as HTMLImageElement
                    target.style.display = 'none'
                    const parent = target.parentElement
                    if (parent) {
                      const placeholder = document.createElement('div')
                      placeholder.className = 'w-32 h-32 flex items-center justify-center bg-gray-100 rounded'
                      placeholder.innerHTML = '<span class="text-gray-400">图片加载失败</span>'
                      parent.appendChild(placeholder)
                    }
                  }}
                />
              ) : (
                <div className="w-32 h-32 flex items-center justify-center bg-gray-100 rounded">
                  <span className="text-gray-400">图片缩略图</span>
                </div>
              )}
            </div>
          </div>
        )}
        {isText && (
          <div className="mt-2">
            <div className="text-sm font-medium mb-1">文本预览:</div>
            <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm font-mono max-h-32 overflow-y-auto">
              <div className="text-gray-500">文本内容预览（需要实现文件读取）</div>
            </div>
          </div>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg p-2 transition-colors"
          title="移除附件"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )}
    </div>
  )
}