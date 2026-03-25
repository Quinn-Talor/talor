import { useState } from 'react'
import type { MCPServer } from '../../../preload/index'
import { ConfirmDialog } from '../../components/ConfirmDialog'

interface MCPServerListProps {
  servers: MCPServer[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string, enabled: boolean) => void
  onTest: (id: string) => void
}

function getServerIcon(server: MCPServer) {
  const nameLower = server.name.toLowerCase()
  const cmdLower = server.command?.toLowerCase() || ''
  
  if (nameLower.includes('file') || nameLower.includes('fs') || cmdLower.includes('file')) return '📁'
  if (nameLower.includes('db') || nameLower.includes('sql') || nameLower.includes('postgres') || cmdLower.includes('sqlite')) return '🗄️'
  return '🔧'
}

export function MCPServerList({
  servers,
  onEdit,
  onDelete,
  onToggleStatus,
  onTest
}: MCPServerListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const serverToDelete = deleteId ? servers.find((s) => s.id === deleteId) : null

  if (servers.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {servers.map((server) => {
          return (
            <div
              key={server.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all flex flex-col"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-50 text-xl shrink-0">
                    {getServerIcon(server)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-medium text-gray-900 truncate">{server.name}</h4>
                      <div className="flex items-center shrink-0">
                        {server.enabled ? (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-green-600">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span> Connected
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-medium text-gray-400">
                            <span className="w-2 h-2 rounded-full bg-gray-300 border border-gray-400"></span> Disabled
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded uppercase tracking-wide ${
                        server.type === 'stdio' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {server.type}
                      </span>
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                        Tools: -
                      </span>
                    </div>
                  </div>
                </div>
                
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input 
                    type="checkbox" 
                    className="sr-only peer" 
                    checked={server.enabled}
                    onChange={(e) => onToggleStatus(server.id, e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              </div>

              <div className="flex-1">
                {server.type === 'stdio' ? (
                  <div className="text-xs text-gray-500 space-y-1 mb-3">
                    <p className="truncate"><span className="font-medium text-gray-700">Cmd:</span> {server.command}</p>
                    <p className="truncate"><span className="font-medium text-gray-700">Args:</span> {server.args?.join(' ') || '-'}</p>
                    {server.env && Object.keys(server.env).length > 0 && (
                      <p className="truncate"><span className="font-medium text-gray-700">Env:</span> {Object.keys(server.env).length} variables</p>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 space-y-1 mb-3">
                    <p className="truncate"><span className="font-medium text-gray-700">URL:</span> {server.url}</p>
                    <p className="truncate"><span className="font-medium text-gray-700">Auth:</span> {server.auth?.type || 'none'}</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-gray-100 mt-auto">
                <button
                  onClick={() => onTest(server.id)}
                  className="flex-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors text-center"
                >
                  测试
                </button>
                <button
                  onClick={() => onEdit(server.id)}
                  className="flex-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors text-center"
                >
                  编辑
                </button>
                <button
                  onClick={() => setDeleteId(server.id)}
                  className="flex-1 px-2.5 py-1.5 text-xs font-medium text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition-colors text-center"
                >
                  删除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {deleteId && serverToDelete && (
        <ConfirmDialog
          title="确认删除"
          message={`确认删除 MCP Server "${serverToDelete.name}"？此操作不可撤销。`}
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={() => {
            onDelete(deleteId)
            setDeleteId(null)
          }}
          onCancel={() => setDeleteId(null)}
          danger
        />
      )}
    </>
  )
}
