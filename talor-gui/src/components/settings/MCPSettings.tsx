/**
 * MCP Settings Component
 *
 * Manages MCP (Model Context Protocol) server configurations.
 * Features:
 * - Built-in preset selector (auto-fills command/args from presets.json)
 * - Add/edit/delete MCP servers via /api/config/mcp CRUD endpoints
 * - Transport selection (stdio / sse / http)
 * - Auth configuration (none / bearer / api_key with keyring reference)
 * - Real-time connection status from /api/mcp/servers
 *
 * @requirements 3.2.1 - MCP Server CRUD 操作
 * @requirements 3.2.2 - MCP Server 配置持久化
 */

import { useCallback, useEffect, useState } from 'react';
import type { MCPPreset } from '../../types/config';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface ServerEntry {
  id: string;
  transport?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
  timeout?: number;
  auth?: {
    type?: string;
    token_ref?: string;
    header_name?: string;
    env_var?: string;
  };
}

interface RuntimeStatus {
  name: string;
  status: string;
  tools_count: number;
}

interface FormData {
  id: string;
  transport: string;
  command: string;
  args: string; // comma-separated
  env: string; // JSON text
  url: string;
  disabled: boolean;
  authType: string;
  tokenRef: string;
  envVar: string;
}

const EMPTY_FORM: FormData = {
  id: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  disabled: false,
  authType: 'none',
  tokenRef: '',
  envVar: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    connected: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    needs_auth: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    disabled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    connecting: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  };
  return styles[status] ?? 'bg-gray-100 text-gray-600';
}

function serverToForm(id: string, s: ServerEntry): FormData {
  return {
    id,
    transport: s.transport ?? 'stdio',
    command: s.command ?? '',
    args: (s.args ?? []).join(', '),
    env: s.env && Object.keys(s.env).length ? JSON.stringify(s.env, null, 2) : '',
    url: s.url ?? '',
    disabled: s.disabled ?? false,
    authType: s.auth?.type ?? 'none',
    tokenRef: s.auth?.token_ref ?? '',
    envVar: s.auth?.env_var ?? '',
  };
}

function formToPayload(form: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    transport: form.transport,
    disabled: form.disabled,
  };
  if (form.command) payload.command = form.command;
  const argsArr = form.args
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (argsArr.length) payload.args = argsArr;
  if (form.env) {
    try {
      payload.env = JSON.parse(form.env);
    } catch {
      // ignore parse error; backend will also validate
    }
  }
  if (form.url) payload.url = form.url;
  if (form.authType !== 'none') {
    const auth: Record<string, string> = { type: form.authType };
    if (form.tokenRef) auth.token_ref = form.tokenRef;
    if (form.envVar) auth.env_var = form.envVar;
    payload.auth = auth;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MCPSettings() {
  const [servers, setServers] = useState<Record<string, ServerEntry>>({});
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, RuntimeStatus>>({});
  const [presets, setPresets] = useState<MCPPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [showPresets, setShowPresets] = useState(false);
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfgRes, statusRes, presetsRes] = await Promise.all([
        fetch('/api/config/mcp'),
        fetch('/api/mcp/servers'),
        fetch('/api/mcp/presets'),
      ]);

      if (cfgRes.ok) {
        const data: Record<string, ServerEntry> = await cfgRes.json();
        setServers(data);
      }
      if (statusRes.ok) {
        const list: RuntimeStatus[] = await statusRes.json();
        const map: Record<string, RuntimeStatus> = {};
        list.forEach((s) => (map[s.name] = s));
        setRuntimeStatus(map);
      }
      if (presetsRes.ok) {
        setPresets(await presetsRes.json());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  const saveServer = async () => {
    if (!form.id) return;
    setSaving(true);
    setError(null);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const url = `/api/config/mcp/${form.id}`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(form)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error((err as { detail?: string }).detail ?? 'Save failed');
      }
      await loadAll();
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP server');
    } finally {
      setSaving(false);
    }
  };

  const deleteServer = async (id: string) => {
    if (!confirm(`删除 MCP 服务器 "${id}"？`)) return;
    setError(null);
    try {
      const res = await fetch(`/api/config/mcp/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server');
    }
  };

  // ---------------------------------------------------------------------------
  // Dialog helpers
  // ---------------------------------------------------------------------------

  const openAddDialog = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowPresets(true);
    setShowDialog(true);
  };

  const openEditDialog = (id: string) => {
    setEditingId(id);
    setForm(serverToForm(id, servers[id] ?? { id }));
    setShowPresets(false);
    setShowDialog(true);
  };

  const closeDialog = () => {
    setShowDialog(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowPresets(false);
  };

  const applyPreset = (preset: MCPPreset) => {
    setForm((prev) => ({
      ...prev,
      id: prev.id || preset.id,
      transport: preset.transport ?? 'stdio',
      command: preset.command ?? '',
      args: (preset.args ?? []).join(', '),
      authType: preset.auth?.type ?? 'none',
      envVar: preset.auth?.env_var ?? '',
    }));
    setShowPresets(false);
  };

  const toggleDisabled = async (id: string) => {
    const cfg = servers[id];
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        transport: cfg.transport ?? 'stdio',
        disabled: !cfg.disabled,
        ...(cfg.command && { command: cfg.command }),
        ...(cfg.args?.length && { args: cfg.args }),
        ...(cfg.env && Object.keys(cfg.env).length && { env: cfg.env }),
        ...(cfg.url && { url: cfg.url }),
        ...(cfg.auth && cfg.auth.type !== 'none' && { auth: cfg.auth }),
      };
      const res = await fetch(`/api/config/mcp/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Toggle failed');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle server');
    }
  };

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const serverIds = Object.keys(servers);
  const canSave = !!form.id && (!!form.command || !!form.url);

  return (
    <div data-testid="mcp-settings">
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}
      {!loading && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">MCP 服务器</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                管理 Model Context Protocol 服务器，扩展 Agent 工具能力
              </p>
            </div>
            <button
              onClick={openAddDialog}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
            >
              + 添加服务器
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {/* Server cards */}
          {serverIds.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center">
              <div className="text-4xl mb-3">🔌</div>
              <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">
                尚未配置 MCP 服务器。从预设一键添加，或手动填写配置。
              </p>
              <button
                onClick={openAddDialog}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                + 添加第一个服务器
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {serverIds.map((id) => {
                const cfg = servers[id];
                const rt = runtimeStatus[id];
                const preset = presets.find((p) => p.id === id);
                const icon = preset?.icon ?? (cfg.transport === 'stdio' ? '⚙️' : '🌐');
                const isDisabled = cfg.disabled ?? false;

                return (
                  <div
                    key={id}
                    className={`relative bg-white dark:bg-gray-800 rounded-xl border transition-all flex flex-col ${
                      isDisabled
                        ? 'border-gray-200 dark:border-gray-700 opacity-60'
                        : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md'
                    }`}
                  >
                    {/* Card body */}
                    <div className="p-5 flex-1">
                      {/* Icon + name + status */}
                      <div className="flex items-start gap-3 mb-3">
                        <span className="text-3xl leading-none shrink-0">{icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900 dark:text-white font-mono text-sm truncate">
                              {id}
                            </span>
                            {rt && (
                              <span
                                className={`px-2 py-0.5 text-xs rounded-full font-medium ${statusBadge(rt.status)}`}
                              >
                                {rt.status === 'connected'
                                  ? `✓ ${rt.tools_count} tools`
                                  : rt.status}
                              </span>
                            )}
                          </div>
                          {preset && (
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                              {preset.name}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Command / URL */}
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg px-3 py-2 mb-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                          {cfg.command
                            ? `${cfg.command} ${(cfg.args ?? []).join(' ')}`
                            : (cfg.url ?? '—')}
                        </p>
                      </div>

                      {/* Auth badge */}
                      {cfg.auth && cfg.auth.type !== 'none' && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                          🔐 {cfg.auth.type}
                          {cfg.auth.env_var ? ` · ${cfg.auth.env_var}` : ''}
                          {cfg.auth.token_ref ? ` · ${cfg.auth.token_ref}` : ''}
                        </p>
                      )}
                    </div>

                    {/* Card footer */}
                    <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
                      {/* Toggle */}
                      <button
                        onClick={() => toggleDisabled(id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          isDisabled
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                            : 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${isDisabled ? 'bg-gray-400' : 'bg-green-500'}`}
                        />
                        {isDisabled ? '已禁用' : '已启用'}
                      </button>

                      {/* Edit + Delete */}
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => openEditDialog(id)}
                          className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => deleteServer(id)}
                          className="px-3 py-1.5 text-xs border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Dialog */}
          {showDialog && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-6 space-y-5">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {editingId ? `编辑 ${editingId}` : '添加 MCP 服务器'}
                  </h3>

                  {/* Preset selector */}
                  {!editingId && presets.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowPresets((v) => !v)}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {showPresets ? '▲ 收起预设' : '▼ 从预设快速填充'}
                      </button>
                      {showPresets && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {presets.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => applyPreset(p)}
                              className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
                            >
                              <span className="text-xl shrink-0">{p.icon}</span>
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">
                                  {p.name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
                                  {p.description}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Form */}
                  <div className="space-y-4">
                    {/* ID */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        服务器 ID <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.id}
                        onChange={(e) => setField('id', e.target.value)}
                        disabled={!!editingId}
                        placeholder="如：playwright、filesystem"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Transport */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        传输方式
                      </label>
                      <select
                        value={form.transport}
                        onChange={(e) => setField('transport', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="stdio">stdio（本地子进程）</option>
                        <option value="sse">SSE（Server-Sent Events）</option>
                        <option value="http">HTTP（Streamable HTTP）</option>
                      </select>
                    </div>

                    {/* stdio fields */}
                    {form.transport === 'stdio' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            命令 <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={form.command}
                            onChange={(e) => setField('command', e.target.value)}
                            placeholder="如：npx、uvx、python"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            参数（逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={form.args}
                            onChange={(e) => setField('args', e.target.value)}
                            placeholder="如：-y, @modelcontextprotocol/server-filesystem"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            环境变量（JSON）
                          </label>
                          <textarea
                            value={form.env}
                            onChange={(e) => setField('env', e.target.value)}
                            placeholder='{"KEY": "value"}'
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs font-mono placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </>
                    )}

                    {/* SSE / HTTP URL */}
                    {(form.transport === 'sse' || form.transport === 'http') && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          URL <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="url"
                          value={form.url}
                          onChange={(e) => setField('url', e.target.value)}
                          placeholder="https://your-mcp-server.example.com"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    {/* Auth */}
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        认证配置
                      </p>
                      <div>
                        <select
                          value={form.authType}
                          onChange={(e) => setField('authType', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="none">无认证</option>
                          <option value="bearer">Bearer Token（HTTP 头）</option>
                          <option value="api_key">API Key（自定义 HTTP 头）</option>
                        </select>
                      </div>
                      {form.authType !== 'none' && form.transport !== 'stdio' && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Keyring 引用（如 keyring:my-api-key）
                          </label>
                          <input
                            type="text"
                            value={form.tokenRef}
                            onChange={(e) => setField('tokenRef', e.target.value)}
                            placeholder="keyring:my-key-name"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}
                      {form.authType !== 'none' && form.transport === 'stdio' && (
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            注入的环境变量名（如 BRAVE_API_KEY）
                          </label>
                          <input
                            type="text"
                            value={form.envVar}
                            onChange={(e) => setField('envVar', e.target.value)}
                            placeholder="MY_API_KEY"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}
                    </div>

                    {/* Disabled */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.disabled}
                        onChange={(e) => setField('disabled', e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        暂时禁用此服务器
                      </span>
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      onClick={closeDialog}
                      className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={saveServer}
                      disabled={!canSave || saving}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      {saving ? '保存中…' : editingId ? '更新' : '添加'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
