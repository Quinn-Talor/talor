/**
 * Provider Settings Component
 *
 * Provider management with model discovery and capability management.
 * - Provider CRUD (add / edit / delete)
 * - Expandable rows showing discovered models
 * - Per-model capability badges and capability override modal
 * - Per-provider model discovery refresh
 * - Connection test
 *
 * @requirements 3.1.1 - Provider CRUD 操作
 * @requirements 3.1.3 - 连接测试
 */

import { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface ConfigProvider {
  name: string;
  api_key_env: string | null;
  base_url: string | null;
  auto_discover: boolean;
  models: unknown[];
}

interface ModelCapabilities {
  vision: boolean;
  function_calling: boolean;
  json_mode: boolean;
  streaming: boolean;
  reasoning: boolean;
  parallel_tool_calls: boolean;
  structured_output: boolean;
}

interface DiscoveredModel {
  id: string;
  name: string;
  provider_id: string;
  context_length: number;
  max_output_tokens: number;
  capabilities: ModelCapabilities;
}

interface ProviderFormData {
  id: string;
  name: string;
  api_key_env: string;
  base_url: string;
  auto_discover: boolean;
}

// ── Capability display config ──────────────────────────────────────────────

const CAP_ICONS: Array<{ key: keyof ModelCapabilities; icon: string; label: string }> = [
  { key: 'vision', icon: '👁', label: 'Vision' },
  { key: 'function_calling', icon: '🔧', label: 'Tools' },
  { key: 'reasoning', icon: '🧠', label: 'Reasoning' },
  { key: 'parallel_tool_calls', icon: '⚡', label: 'Parallel Tools' },
  { key: 'structured_output', icon: '📋', label: 'Structured Output' },
  { key: 'json_mode', icon: '{}', label: 'JSON Mode' },
  { key: 'streaming', icon: '~', label: 'Streaming' },
];

const CAP_LABELS: Record<keyof ModelCapabilities, string> = {
  vision: 'Vision (multimodal)',
  function_calling: 'Function / Tool Calling',
  json_mode: 'JSON Mode',
  streaming: 'Streaming',
  reasoning: 'Reasoning (extended thinking)',
  parallel_tool_calls: 'Parallel Tool Calls',
  structured_output: 'Structured Output (JSON Schema)',
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ProviderSettings() {
  // Provider config (from /api/config/providers)
  const [configProviders, setConfigProviders] = useState<Record<string, ConfigProvider>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expand / collapse
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  // Discovered models (from /api/providers/{id}/models)
  const [providerModels, setProviderModels] = useState<Record<string, DiscoveredModel[]>>({});
  const [loadingModels, setLoadingModels] = useState<Set<string>>(new Set());
  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  // Capabilities modal
  const [capsModal, setCapsModal] = useState<{
    providerId: string;
    modelId: string;
    caps: ModelCapabilities;
  } | null>(null);
  const [savingCaps, setSavingCaps] = useState(false);

  // Add / Edit provider dialog
  const [showDialog, setShowDialog] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>({
    id: '',
    name: '',
    api_key_env: '',
    base_url: '',
    auto_discover: true,
  });
  const [submitting, setSubmitting] = useState(false);

  // Connection test
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { success: boolean; message: string }>
  >({});

  // ── Load config providers ─────────────────────────────────────────────

  const loadConfigProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/config/providers');
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: Record<string, ConfigProvider> = await res.json();
      setConfigProviders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigProviders();
  }, [loadConfigProviders]);

  // ── Load discovered models for one provider ───────────────────────────

  const loadModels = useCallback(async (providerId: string) => {
    setLoadingModels((prev) => new Set(prev).add(providerId));
    try {
      const res = await fetch(`/api/providers/${providerId}/models`);
      if (res.ok) {
        const data: DiscoveredModel[] = await res.json();
        setProviderModels((prev) => ({ ...prev, [providerId]: data }));
      }
    } finally {
      setLoadingModels((prev) => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    }
  }, []);

  // ── Expand / collapse ─────────────────────────────────────────────────

  const toggleExpand = (providerId: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
        if (!providerModels[providerId]) {
          void loadModels(providerId);
        }
      }
      return next;
    });
  };

  // ── Refresh model discovery ───────────────────────────────────────────

  const refreshModels = async (providerId: string) => {
    setRefreshingProvider(providerId);
    try {
      await fetch(`/api/providers/${providerId}/refresh`, { method: 'POST' });
      await loadModels(providerId);
    } finally {
      setRefreshingProvider(null);
    }
  };

  // ── Connection test ───────────────────────────────────────────────────

  const testConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    try {
      const res = await fetch(`/api/config/providers/${providerId}/test`, { method: 'POST' });
      const result = (await res.json()) as { success: boolean; model?: string; error?: string };
      const msg = result.success
        ? `OK · ${result.model ?? ''}`
        : (result.error ?? 'Connection failed');
      setTestResults((prev) => ({
        ...prev,
        [providerId]: { success: result.success, message: msg },
      }));
      setTimeout(
        () =>
          setTestResults((prev) => {
            const next = { ...prev };
            delete next[providerId];
            return next;
          }),
        5000
      );
    } finally {
      setTestingProvider(null);
    }
  };

  // ── Capabilities modal ────────────────────────────────────────────────

  const openCapsModal = (providerId: string, model: DiscoveredModel) => {
    setCapsModal({ providerId, modelId: model.id, caps: { ...model.capabilities } });
  };

  const saveCaps = async () => {
    if (!capsModal) return;
    setSavingCaps(true);
    try {
      const res = await fetch(
        `/api/providers/${capsModal.providerId}/models/${encodeURIComponent(capsModal.modelId)}/capabilities`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(capsModal.caps),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      await loadModels(capsModal.providerId);
      setCapsModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save capabilities');
    } finally {
      setSavingCaps(false);
    }
  };

  // ── CRUD ──────────────────────────────────────────────────────────────

  const openAddDialog = () => {
    setFormData({ id: '', name: '', api_key_env: '', base_url: '', auto_discover: true });
    setEditingProviderId(null);
    setShowDialog(true);
  };

  const openEditDialog = (id: string, provider: ConfigProvider) => {
    setFormData({
      id,
      name: provider.name,
      api_key_env: provider.api_key_env ?? '',
      base_url: provider.base_url ?? '',
      auto_discover: provider.auto_discover,
    });
    setEditingProviderId(id);
    setShowDialog(true);
  };

  const submitProvider = async () => {
    const providerId = editingProviderId ?? formData.id.trim();
    if (!providerId || !formData.name) return;
    setSubmitting(true);
    try {
      const method = editingProviderId ? 'PUT' : 'POST';
      const res = await fetch(`/api/config/providers/${providerId}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          api_key_env: formData.api_key_env || null,
          base_url: formData.base_url || null,
          auto_discover: formData.auto_discover,
          models: [],
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await loadConfigProviders();
      setShowDialog(false);
      setEditingProviderId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save provider');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteProvider = async (id: string) => {
    if (!confirm(`Delete provider "${id}"?`)) return;
    try {
      const res = await fetch(`/api/config/providers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await loadConfigProviders();
      setExpandedProviders((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setProviderModels((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete provider');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const providerEntries = Object.entries(configProviders);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">LLM Providers</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {providerEntries.length} provider{providerEntries.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={openAddDialog}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors text-sm"
        >
          + Add Provider
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex justify-between items-start">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs text-red-500 hover:underline ml-3 flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Provider list */}
      <div className="space-y-2">
        {providerEntries.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">
              No providers configured. Add your first provider to get started.
            </p>
          </div>
        ) : (
          providerEntries.map(([id, provider]) => {
            const isExpanded = expandedProviders.has(id);
            const models = providerModels[id] ?? [];
            const isLoadingModels = loadingModels.has(id);
            const isRefreshing = refreshingProvider === id;
            const isTesting = testingProvider === id;
            const testResult = testResults[id];

            return (
              <div
                key={id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {/* Provider header */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  {/* Expand toggle + name */}
                  <button
                    onClick={() => toggleExpand(id)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0 group"
                  >
                    <span className="text-gray-400 text-xs w-3 flex-shrink-0 group-hover:text-gray-600 dark:group-hover:text-gray-300">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
                      {provider.name}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono flex-shrink-0">
                      {id}
                    </span>
                    {isExpanded && providerModels[id] !== undefined && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {models.length} model{models.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </button>

                  {/* Status + actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {/* Connection status / test result */}
                    {testResult ? (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          testResult.success
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }`}
                      >
                        {testResult.success ? '✓' : '✗'} {testResult.message}
                      </span>
                    ) : provider.api_key_env ? (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full font-mono">
                        {provider.api_key_env}
                      </span>
                    ) : null}

                    <button
                      onClick={() => void testConnection(id)}
                      disabled={isTesting}
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded transition-colors disabled:opacity-50"
                    >
                      {isTesting ? '…' : 'Test'}
                    </button>
                    <button
                      onClick={() => openEditDialog(id, provider)}
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void deleteProvider(id)}
                      className="px-2 py-1 text-xs border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {/* Expanded: model list */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/20">
                    {/* Models sub-header */}
                    <div className="flex items-center justify-between px-4 py-1.5">
                      <span className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide">
                        {isLoadingModels
                          ? 'Loading…'
                          : `${models.length} model${models.length !== 1 ? 's' : ''} discovered`}
                      </span>
                      <button
                        onClick={() => void refreshModels(id)}
                        disabled={isRefreshing || isLoadingModels}
                        className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                      >
                        <span className={isRefreshing ? 'inline-block animate-spin' : ''}>↻</span>{' '}
                        Refresh
                      </button>
                    </div>

                    {/* Empty state */}
                    {!isLoadingModels && models.length === 0 && (
                      <p className="px-4 pb-3 text-xs text-gray-400 dark:text-gray-500">
                        No models discovered.
                        {provider.api_key_env != null &&
                          ` Set ${provider.api_key_env} in your environment and click Refresh.`}
                        {provider.api_key_env == null &&
                          provider.base_url != null &&
                          ' Make sure the service is running and click Refresh.'}
                      </p>
                    )}

                    {/* Model rows */}
                    {models.length > 0 && (
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                        {models.map((model) => (
                          <div
                            key={model.id}
                            className="flex items-center gap-3 px-4 py-1.5 hover:bg-gray-100/50 dark:hover:bg-gray-800/30"
                          >
                            {/* Model name */}
                            <span
                              title={model.id}
                              className="text-xs font-mono text-gray-800 dark:text-gray-200 min-w-0 flex-1 truncate"
                            >
                              {model.name || model.id}
                            </span>

                            {/* Capability icons */}
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {CAP_ICONS.filter(({ key }) => model.capabilities[key]).map(
                                ({ key, icon, label }) => (
                                  <span
                                    key={key}
                                    title={label}
                                    className="text-xs px-1 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded"
                                  >
                                    {icon}
                                  </span>
                                )
                              )}
                            </div>

                            {/* Edit caps */}
                            <button
                              onClick={() => openCapsModal(id, model)}
                              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0 transition-colors"
                            >
                              Edit Caps
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <p className="px-4 py-2 text-xs text-gray-400 dark:text-gray-500 italic">
                      Capability overrides are persisted to config. Use Refresh to re-discover.
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Add / Edit Provider Dialog ───────────────────────────────── */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                {editingProviderId ? `Edit: ${editingProviderId}` : 'Add Provider'}
              </h3>

              <div className="space-y-4">
                {/* Provider ID — only for new providers */}
                {!editingProviderId && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                      Provider ID *
                    </label>
                    <input
                      type="text"
                      value={formData.id}
                      onChange={(e) => setFormData((f) => ({ ...f, id: e.target.value }))}
                      placeholder="e.g., openai, anthropic, my-custom"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Display Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g., OpenAI"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    API Key Env Variable
                  </label>
                  <input
                    type="text"
                    value={formData.api_key_env}
                    onChange={(e) => setFormData((f) => ({ ...f, api_key_env: e.target.value }))}
                    placeholder="e.g., OPENAI_API_KEY (leave empty for local)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Name of the environment variable holding the API key
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                    Base URL
                  </label>
                  <input
                    type="text"
                    value={formData.base_url}
                    onChange={(e) => setFormData((f) => ({ ...f, base_url: e.target.value }))}
                    placeholder="e.g., https://api.openai.com/v1"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.auto_discover}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, auto_discover: e.target.checked }))
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    Auto-discover models on startup
                  </span>
                </label>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowDialog(false);
                    setEditingProviderId(null);
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void submitProvider()}
                  disabled={!formData.name || (!editingProviderId && !formData.id) || submitting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors text-sm"
                >
                  {submitting ? 'Saving…' : editingProviderId ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Capabilities Edit Modal ───────────────────────────────────── */}
      {capsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Edit Capabilities
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mb-4">
                {capsModal.providerId}/{capsModal.modelId}
              </p>

              <div className="space-y-3">
                {(Object.keys(CAP_LABELS) as Array<keyof ModelCapabilities>).map((key) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {CAP_LABELS[key]}
                    </span>
                    <input
                      type="checkbox"
                      checked={capsModal.caps[key]}
                      onChange={(e) =>
                        setCapsModal((m) =>
                          m ? { ...m, caps: { ...m.caps, [key]: e.target.checked } } : m
                        )
                      }
                      className="rounded flex-shrink-0"
                    />
                  </label>
                ))}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setCapsModal(null)}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveCaps()}
                  disabled={savingCaps}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  {savingCaps ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
