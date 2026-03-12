/**
 * WorkspaceDrawer Component
 * 工作成果抽屉组件
 *
 * A right-side drawer showing task artifacts with file previews.
 */

import React, { useEffect, useState } from 'react';
import type { TaskArtifact } from '../../api/task';

interface WorkspaceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string;
  artifacts: TaskArtifact[];
  onPreviewFile: (path: string) => Promise<string>;
}

function formatRelativeTime(updatedAt: number): string {
  const seconds = Math.floor((Date.now() - updatedAt) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

function getFileIcon(path: string, type: string): string {
  if (type === 'directory') return '📁';
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'md' || ext === 'markdown') return '📄';
  if (ext === 'py') return '🐍';
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return '📜';
  if (ext === 'json') return '{}';
  if (ext === 'css' || ext === 'scss') return '🎨';
  return '📄';
}

export const WorkspaceDrawer: React.FC<WorkspaceDrawerProps> = ({
  isOpen,
  onClose,
  artifacts,
  onPreviewFile,
}) => {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Reset preview when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setPreviewPath(null);
      setPreviewContent('');
    }
  }, [isOpen]);

  const handlePreview = async (path: string) => {
    if (previewPath === path) {
      setPreviewPath(null);
      setPreviewContent('');
      return;
    }
    setPreviewPath(path);
    setPreviewLoading(true);
    try {
      const content = await onPreviewFile(path);
      setPreviewContent(content);
    } catch {
      setPreviewContent('无法加载文件内容');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 dark:bg-black/40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`
          fixed right-0 top-0 bottom-0 z-50 w-80
          bg-white dark:bg-gray-800
          border-l border-gray-200 dark:border-gray-700
          shadow-xl
          flex flex-col
          transition-transform duration-300
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            工作成果
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Artifact list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 dark:text-gray-500">
              <p className="text-sm">暂无成果文件</p>
              <p className="text-xs mt-1">任务运行中将自动更新</p>
            </div>
          ) : (
            artifacts.map((artifact) => (
              <div key={artifact.path} className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* File header */}
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-750">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-base">{getFileIcon(artifact.path, artifact.type)}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                        {artifact.path.split('/').pop()}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {artifact.type === 'directory' ? '目录' : '文件'} · {formatRelativeTime(artifact.updatedAt)}
                      </p>
                    </div>
                  </div>
                  {artifact.type === 'file' && (
                    <button
                      type="button"
                      onClick={() => handlePreview(artifact.path)}
                      className="flex-shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:underline ml-2"
                    >
                      {previewPath === artifact.path ? '收起' : '预览'}
                    </button>
                  )}
                </div>

                {/* Inline preview */}
                {previewPath === artifact.path && (
                  <div className="border-t border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900 max-h-48 overflow-y-auto">
                    {previewLoading ? (
                      <div className="text-xs text-gray-400 animate-pulse">加载中...</div>
                    ) : (
                      <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                        {previewContent.slice(0, 1000)}{previewContent.length > 1000 ? '\n...' : ''}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

export default WorkspaceDrawer;
