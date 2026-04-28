import { useState } from 'react'
import type { MCPServer } from '../../../preload/index'
import { ConfirmDialog } from '../../components/ConfirmDialog'

interface MCPServerStatus { serverId: string; name: string; connected: boolean; toolCount: number }

interface MCPServerListProps {
  servers: MCPServer[]
  serverStatus: MCPServerStatus[]
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onToggleStatus: (id: string, enabled: boolean) => void
  onTest: (id: string) => void
}

function getInitial(name: string) { return name.charAt(0).toUpperCase() }

function getServerStatus(serverId: string, statusList: MCPServerStatus[]) {
  const s = statusList.find(s => s.serverId === serverId)
  return s ?? { connected: false, toolCount: 0 }
}

export function MCPServerList({ servers, serverStatus, onEdit, onDelete, onToggleStatus, onTest }: MCPServerListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const serverToDelete = deleteId ? servers.find((s) => s.id === deleteId) : null
  if (servers.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {servers.map((server) => {
          const status = getServerStatus(server.id, serverStatus)
          return (
            <div
              key={server.id}
              className={`bg-white rounded-xl flex flex-col ${!server.enabled ? 'opacity-50' : ''}`}
              style={{ border: '1px solid #e8eaed' }}
            >
              <div className="p-4 flex items-start gap-3 flex-1">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white text-[15px] font-bold"
                  style={{ background: 'linear-gradient(135deg, #8b5cf6cc, #7c3aed)' }}>
                  {getInitial(server.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-800 truncate">{server.name}</span>
                    {server.enabled ? (
                      status.connected
                        ? <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-green-50 text-green-600">已连接</span>
                        : <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-50 text-red-500">未连接</span>
                    ) : (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400">已禁用</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                    {server.type === 'stdio' ? server.command : server.url}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md uppercase tracking-wide ${
                      server.type === 'stdio' ? 'bg-blue-50 text-blue-500' : 'bg-purple-50 text-purple-500'
                    }`}>{server.type}</span>
                    {status.connected && status.toolCount > 0 && (
                      <span className="text-[11px] text-gray-400">{status.toolCount} 工具</span>
                    )}
                  </div>
                </div>
                {/* Toggle */}
                <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                  <input type="checkbox" className="sr-only peer" checked={server.enabled} onChange={(e) => onToggleStatus(server.id, e.target.checked)} />
                  <div className="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"></div>
                </label>
              </div>

              <div className="flex items-center border-t px-3 py-2 gap-1" style={{ borderColor: '#f1f3f4' }}>
                <ActionBtn onClick={() => onTest(server.id)}>测试</ActionBtn>
                <ActionBtn onClick={() => onEdit(server.id)}>编辑</ActionBtn>
                <ActionBtn onClick={() => setDeleteId(server.id)} danger>删除</ActionBtn>
              </div>
            </div>
          )
        })}
      </div>

      {deleteId && serverToDelete && (
        <ConfirmDialog
          title="确认删除"
          message={`确认删除 "${serverToDelete.name}"？此操作不可撤销。`}
          confirmLabel="删除" cancelLabel="取消"
          onConfirm={() => { onDelete(deleteId); setDeleteId(null) }}
          onCancel={() => setDeleteId(null)}
          danger
        />
      )}
    </>
  )
}

function ActionBtn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-30 ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  )
}
