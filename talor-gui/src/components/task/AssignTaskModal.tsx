/**
 * AssignTaskModal Component
 * 指派工作对话框
 *
 * Modal for creating a new background task (assigning work to an agent).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { AgentInfo } from '../../api/agent';

interface AssignTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (params: {
    title: string;
    agentId: string;
    prompt: string;
    useWorktree: boolean;
  }) => Promise<void>;
  agents: AgentInfo[];
  isLoading?: boolean;
}

export const AssignTaskModal: React.FC<AssignTaskModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  agents,
  isLoading = false,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Select first agent by default
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].name);
    }
  }, [agents, selectedAgentId]);

  // Focus textarea when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      // Reset form on close
      setPrompt('');
      setUseWorktree(false);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedAgent = agents.find((a) => a.name === selectedAgentId);
  const title = prompt.split('\n')[0].slice(0, 80) || '新任务';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || !selectedAgentId || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit({
        title,
        agentId: selectedAgentId,
        prompt: prompt.trim(),
        useWorktree,
      });
      onClose();
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* Modal */}
        <div className="w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">指派工作</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Agent selector */}
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1.5">
                交给
              </label>
              <div className="flex flex-wrap gap-2">
                {isLoading ? (
                  <div className="text-sm text-gray-400 animate-pulse">加载 Agent...</div>
                ) : agents.length === 0 ? (
                  <div className="text-sm text-gray-400">暂无可用 Agent</div>
                ) : (
                  agents.map((agent) => (
                    <button
                      key={agent.name}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.name)}
                      className={`
                        px-3 py-1.5 rounded-lg text-sm border transition-colors
                        ${selectedAgentId === agent.name
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                          : 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'}
                      `}
                    >
                      🤖 {agent.name}
                    </button>
                  ))
                )}
              </div>
              {selectedAgent?.description && (
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {selectedAgent.description}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700" />

            {/* Prompt input */}
            <div>
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="描述要完成的工作... (⌘+Enter 提交)"
                rows={5}
                className="
                  w-full resize-none
                  text-sm text-gray-900 dark:text-white
                  placeholder-gray-400 dark:placeholder-gray-500
                  bg-transparent
                  border-0 outline-none focus:ring-0
                "
              />
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 dark:border-gray-700" />

            {/* Worktree option */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(e) => setUseWorktree(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                使用独立工作区（隔离文件修改）
              </span>
            </label>

            {/* Submit */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={!prompt.trim() || !selectedAgentId || submitting}
                className="
                  inline-flex items-center gap-1.5
                  px-4 py-2
                  text-sm font-medium text-white
                  bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600
                  rounded-lg
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                {submitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    指派中...
                  </>
                ) : (
                  <>
                    开始工作
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default AssignTaskModal;
