import { useState, useEffect, useCallback } from 'react'
import { talorAPI } from '../../api/talorAPI'

interface AccountKey {
  name: string
  value: string
  secret: boolean
}

interface Account {
  service: string
  keys: AccountKey[]
}

export function AccountsSettings() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [editService, setEditService] = useState('')
  const [editKeys, setEditKeys] = useState<AccountKey[]>([])
  const [isAdding, setIsAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await talorAPI.accounts.list() as Account[]
      setAccounts(list)
    } catch (err) {
      console.error('Failed to load accounts:', err)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!editService.trim()) return
    try {
      await talorAPI.accounts.save({ service: editService, keys: editKeys })
      setIsAdding(false)
      setEditService('')
      setEditKeys([])
      await load()
    } catch (err) {
      console.error('Failed to save account:', err)
    }
  }

  const handleDelete = async (service: string) => {
    try {
      await talorAPI.accounts.delete(service)
      await load()
    } catch (err) {
      console.error('Failed to delete account:', err)
    }
  }

  const addKey = () => {
    setEditKeys([...editKeys, { name: '', value: '', secret: false }])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">账户管理</h3>
        <button
          onClick={() => { setIsAdding(true); setEditService(''); setEditKeys([{ name: '', value: '', secret: false }]) }}
          className="text-xs px-3 py-1 bg-primary-500 text-white rounded-lg hover:bg-primary-600"
        >
          添加账户
        </button>
      </div>

      {isAdding && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white">
          <input
            type="text"
            placeholder="服务名称（如：飞书）"
            value={editService}
            onChange={e => setEditService(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          {editKeys.map((key, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                placeholder="Key 名称"
                value={key.name}
                onChange={e => {
                  const updated = [...editKeys]
                  updated[i] = { ...updated[i], name: e.target.value }
                  setEditKeys(updated)
                }}
                className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              <input
                type={key.secret ? 'password' : 'text'}
                placeholder="值"
                value={key.value}
                onChange={e => {
                  const updated = [...editKeys]
                  updated[i] = { ...updated[i], value: e.target.value }
                  setEditKeys(updated)
                }}
                className="flex-1 text-sm border border-gray-200 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
              />
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={key.secret}
                  onChange={e => {
                    const updated = [...editKeys]
                    updated[i] = { ...updated[i], secret: e.target.checked }
                    setEditKeys(updated)
                  }}
                />
                密钥
              </label>
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={addKey} className="text-xs text-primary-500 hover:text-primary-600">+ 添加 Key</button>
            <div className="flex-1" />
            <button onClick={() => setIsAdding(false)} className="text-xs px-3 py-1 text-gray-500 hover:text-gray-700">取消</button>
            <button onClick={handleSave} className="text-xs px-3 py-1 bg-primary-500 text-white rounded hover:bg-primary-600">保存</button>
          </div>
        </div>
      )}

      {accounts.map(acc => (
        <div key={acc.service} className="border border-gray-200 rounded-lg p-3 bg-white">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">{acc.service}</span>
            <button
              onClick={() => handleDelete(acc.service)}
              className="text-xs text-red-500 hover:text-red-600"
            >
              删除
            </button>
          </div>
          <div className="space-y-1">
            {acc.keys.map(key => (
              <div key={key.name} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-32 truncate">{key.name}</span>
                <span className="text-gray-700 font-mono">{key.value}</span>
                {key.secret && <span className="text-[10px] text-amber-600 bg-amber-50 px-1 rounded">密钥</span>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {accounts.length === 0 && !isAdding && (
        <p className="text-xs text-gray-400 text-center py-4">暂无账户配置</p>
      )}
    </div>
  )
}
