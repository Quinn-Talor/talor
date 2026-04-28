import { useState, useEffect, useCallback, useRef } from 'react'
import { talorAPI } from '../../api/talorAPI'

interface AccountKey { name: string; value: string; secret: boolean }
interface Account { service: string; keys: AccountKey[] }

export function AccountsSettings({ addTrigger }: { addTrigger?: number }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [editService, setEditService] = useState('')
  const [editKeys, setEditKeys] = useState<AccountKey[]>([])
  const [isAdding, setIsAdding] = useState(false)

  const prevTrigger = useRef(addTrigger)
  useEffect(() => {
    if (addTrigger !== undefined && addTrigger !== prevTrigger.current) {
      prevTrigger.current = addTrigger
      setIsAdding(true); setEditService(''); setEditKeys([{ name: '', value: '', secret: false }])
    }
  }, [addTrigger])

  const load = useCallback(async () => {
    try { setAccounts(await talorAPI.accounts.list() as Account[]) }
    catch (err) { console.error('Failed to load accounts:', err) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!editService.trim()) return
    try {
      await talorAPI.accounts.save({ service: editService, keys: editKeys })
      setIsAdding(false); setEditService(''); setEditKeys([])
      await load()
    } catch (err) { console.error('Failed to save account:', err) }
  }

  const handleDelete = async (service: string) => {
    try { await talorAPI.accounts.delete(service); await load() }
    catch (err) { console.error('Failed to delete account:', err) }
  }

  return (
    <div className="space-y-4">

      {isAdding && (
        <div className="bg-white rounded-xl p-4 space-y-3" style={{ border: '1px solid #e8eaed' }}>
          <input
            type="text" placeholder="服务名称（如：飞书）" value={editService}
            onChange={e => setEditService(e.target.value)}
            className="w-full text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {editKeys.map((key, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input type="text" placeholder="Key 名称" value={key.name}
                onChange={e => { const u = [...editKeys]; u[i] = { ...u[i], name: e.target.value }; setEditKeys(u) }}
                className="flex-1 text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <input type={key.secret ? 'password' : 'text'} placeholder="值" value={key.value}
                onChange={e => { const u = [...editKeys]; u[i] = { ...u[i], value: e.target.value }; setEditKeys(u) }}
                className="flex-1 text-[13px] border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <label className="flex items-center gap-1 text-[11px] text-gray-500">
                <input type="checkbox" checked={key.secret}
                  onChange={e => { const u = [...editKeys]; u[i] = { ...u[i], secret: e.target.checked }; setEditKeys(u) }}
                />
                密钥
              </label>
            </div>
          ))}
          <div className="flex gap-2 items-center">
            <button onClick={() => setEditKeys([...editKeys, { name: '', value: '', secret: false }])} className="text-[11px] text-blue-500 hover:text-blue-600">+ 添加 Key</button>
            <div className="flex-1" />
            <button onClick={() => setIsAdding(false)} className="text-[11px] px-3 py-1.5 text-gray-500 hover:bg-gray-100 rounded-lg">取消</button>
            <button onClick={handleSave} className="text-[11px] px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">保存</button>
          </div>
        </div>
      )}

      {accounts.length === 0 && !isAdding && (
        <p className="text-[13px] text-gray-400 text-center py-10">暂无账户配置</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {accounts.map(acc => (
          <div key={acc.service} className="bg-white rounded-xl flex flex-col" style={{ border: '1px solid #e8eaed' }}>
            <div className="p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white text-[15px] font-bold"
                style={{ background: 'linear-gradient(135deg, #10b981bb, #059669)' }}>
                {acc.service.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-gray-800 truncate">{acc.service}</span>
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400">{acc.keys.length} 个密钥</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {acc.keys.map(key => (
                    <div key={key.name} className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-gray-400 truncate">{key.name}</span>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-600 font-mono truncate">{key.secret ? '••••••' : key.value}</span>
                      {key.secret && <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">密钥</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center border-t px-3 py-2" style={{ borderColor: '#f1f3f4' }}>
              <button onClick={() => handleDelete(acc.service)} className="text-[11px] text-red-500 hover:bg-red-50 px-2 py-1 rounded-md transition-colors">删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
