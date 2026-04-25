import { useState } from 'react'
import type { MCPServer, MCPServerInput, MCPServerType, MCPAuthConfig } from '../../../preload/index'

interface MCPServerFormProps {
  server?: MCPServer
  existingNames: string[]
  onSubmit: (data: MCPServerInput) => void
  onCancel: () => void
}

export function MCPServerForm({
  server,
  existingNames,
  onSubmit,
  onCancel
}: MCPServerFormProps) {
  const [type, setType] = useState<MCPServerType>(server?.type ?? 'stdio')
  const [name, setName] = useState(server?.name ?? '')
  const [enabled, setEnabled] = useState(server?.enabled ?? true)
  
  const [command, setCommand] = useState(server?.command ?? '')
  const [argsStr, setArgsStr] = useState(server?.args?.join('\n') ?? '')
  const [envPairs, setEnvPairs] = useState<{key: string, value: string}[]>(
    server?.env ? Object.entries(server.env).map(([k, v]) => ({ key: k, value: v })) : []
  )

  const [url, setUrl] = useState(server?.url ?? '')
  const [authType, setAuthType] = useState<MCPAuthConfig['type']>(server?.auth?.type ?? 'none')
  const [authToken, setAuthToken] = useState(server?.auth?.token ?? '')
  
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}
    if (!name.trim()) {
      newErrors.name = '请输入服务器名称'
    } else if (existingNames.includes(name.trim()) && name.trim() !== server?.name) {
      newErrors.name = '名称已存在，请使用其他名称'
    }

    if (type === 'stdio' && !command.trim()) {
      newErrors.command = '请输入启动命令'
    }

    if (type === 'http' && !url.trim()) {
      newErrors.url = '请输入服务 URL'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return

    const input: MCPServerInput = {
      name: name.trim(),
      type,
      enabled
    }

    if (type === 'stdio') {
      input.command = command.trim()
      input.args = argsStr.split('\n').map(a => a.trim()).filter(a => a)
      
      const envObj: Record<string, string> = {}
      envPairs.forEach(p => {
        if (p.key.trim()) envObj[p.key.trim()] = p.value
      })
      input.env = Object.keys(envObj).length > 0 ? envObj : undefined
    } else {
      input.url = url.trim()
      input.auth = { type: authType }
      if (authType !== 'none' && authToken.trim()) {
        input.auth.token = authToken.trim()
      }
    }

    onSubmit(input)
  }

  const handleAddEnv = () => {
    setEnvPairs([...envPairs, { key: '', value: '' }])
  }

  const handleUpdateEnv = (index: number, field: 'key' | 'value', val: string) => {
    const newPairs = [...envPairs]
    newPairs[index][field] = val
    setEnvPairs(newPairs)
  }

  const handleRemoveEnv = (index: number) => {
    setEnvPairs(envPairs.filter((_, i) => i !== index))
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900 mb-4">
        {server ? '编辑 MCP Server' : '新增 MCP Server'}
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：My Local Filesystem"
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              errors.name ? 'border-red-400' : 'border-gray-200'
            }`}
          />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">连接类型</label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="serverType"
                value="stdio"
                checked={type === 'stdio'}
                onChange={() => setType('stdio')}
                className="text-primary-500 focus:ring-primary-500"
              />
              <span>STDIO (本地进程)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="radio"
                name="serverType"
                value="http"
                checked={type === 'http'}
                onChange={() => setType('http')}
                className="text-primary-500 focus:ring-primary-500"
              />
              <span>HTTP (远程 API)</span>
            </label>
          </div>
        </div>

        {type === 'stdio' && (
          <div className="space-y-4 pt-2 border-t border-gray-100">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">启动命令</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="例如：npx, python3, /usr/bin/local/tool"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  errors.command ? 'border-red-400' : 'border-gray-200'
                }`}
              />
              {errors.command && <p className="mt-1 text-xs text-red-500">{errors.command}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">参数 - 每行一个</label>
              <textarea
                value={argsStr}
                onChange={(e) => setArgsStr(e.target.value)}
                placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/Users/Shared"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-gray-500">环境变量</label>
                <button
                  type="button"
                  onClick={handleAddEnv}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  + 添加变量
                </button>
              </div>
              
              <div className="space-y-2 mt-2">
                {envPairs.map((pair, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={pair.key}
                      onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                      placeholder="KEY"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                    />
                    <span className="text-gray-400">=</span>
                    <input
                      type="text"
                      value={pair.value}
                      onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                      placeholder="VALUE"
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveEnv(index)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {envPairs.length === 0 && (
                  <p className="text-xs text-gray-400 italic">没有配置环境变量</p>
                )}
              </div>
            </div>
          </div>
        )}

        {type === 'http' && (
          <div className="space-y-4 pt-2 border-t border-gray-100">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">服务 URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="例如：http://localhost:3000/sse"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                  errors.url ? 'border-red-400' : 'border-gray-200'
                }`}
              />
              {errors.url && <p className="mt-1 text-xs text-red-500">{errors.url}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">认证方式</label>
              <select
                value={authType}
                onChange={(e) => setAuthType(e.target.value as MCPAuthConfig['type'])}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="none">无 (None)</option>
                <option value="bearer">Bearer Token</option>
                <option value="apiKey">API Key</option>
              </select>
            </div>

            {authType !== 'none' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">凭证 (Token / API Key)</label>
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={`请输入 ${authType === 'bearer' ? 'Bearer Token' : 'API Key'}`}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-4 mt-2 border-t border-gray-100">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <label htmlFor="enabled" className="text-sm text-gray-600">启用该服务</label>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  )
}