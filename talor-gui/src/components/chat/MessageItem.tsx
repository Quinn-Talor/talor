/**
 * MessageItem Component
 * 消息展示组件
 *
 * Displays a single message in the chat view with different styles
 * for user and assistant messages, tool call display, and streaming indicator.
 *
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 * @requirements 3.4 - 显示工具名称、参数和执行结果
 * @requirements 3.5 - 显示流式输出并指示加载状态
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message, ToolCall, ToolResult } from '../../types/message';
import { MarkdownRenderer } from '../common/MarkdownRenderer';

/**
 * Props for the MessageItem component
 * MessageItem 组件的属性
 */
export interface MessageItemProps {
  /** The message to display / 要显示的消息 */
  message: Message;
  /** Whether the message is currently streaming / 消息是否正在流式输出 */
  isStreaming?: boolean;
}

/**
 * Props for the ToolCallDisplay component
 * ToolCallDisplay 组件的属性
 */
interface ToolCallDisplayProps {
  /** The tool call to display / 要显示的工具调用 */
  toolCall: ToolCall;
  /** The result of the tool call (if available) / 工具调用结果（如果有） */
  toolResult?: ToolResult;
}

/**
 * Format tool arguments for display
 * 格式化工具参数以便显示
 */
function formatArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * ToolCallDisplay component
 * 工具调用显示组件
 *
 * Displays a single tool call with its name, arguments, and result.
 *
 * @requirements 3.4 - 显示工具名称、参数和执行结果
 */
const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({ toolCall, toolResult }) => {
  const { t } = useTranslation();

  const formattedArgs = useMemo(
    () => formatArguments(toolCall.arguments),
    [toolCall.arguments]
  );

  return (
    <div
      className="
        mt-3 rounded-lg border
        border-gray-200 dark:border-gray-700
        bg-gray-50 dark:bg-gray-800/50
        overflow-hidden
      "
      data-testid="tool-call-display"
    >
      {/* Tool call header */}
      <div
        className="
          px-3 py-2
          bg-gray-100 dark:bg-gray-800
          border-b border-gray-200 dark:border-gray-700
          flex items-center gap-2
        "
      >
        <svg
          className="w-4 h-4 text-blue-500 dark:text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('message.toolCall')}
        </span>
        <span className="text-sm font-mono text-blue-600 dark:text-blue-400">
          {toolCall.name}
        </span>
      </div>

      {/* Tool arguments */}
      <div className="p-3">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {t('message.toolArguments')}
        </div>
        <pre
          className="
            text-xs font-mono
            p-2 rounded
            bg-gray-100 dark:bg-gray-900
            text-gray-700 dark:text-gray-300
            overflow-x-auto
            max-h-40
          "
          data-testid="tool-arguments"
        >
          {formattedArgs}
        </pre>
      </div>

      {/* Tool result (if available) */}
      {toolResult && (
        <div
          className="
            p-3 pt-0
            border-t border-gray-200 dark:border-gray-700
          "
        >
          <div
            className={`
              text-xs font-medium mb-1
              ${toolResult.error
                ? 'text-red-500 dark:text-red-400'
                : 'text-green-600 dark:text-green-400'
              }
            `}
          >
            {toolResult.error ? t('message.toolError') : t('message.toolOutput')}
          </div>
          <pre
            className={`
              text-xs font-mono
              p-2 rounded
              overflow-x-auto
              max-h-60
              ${toolResult.error
                ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
              }
            `}
            data-testid="tool-result"
          >
            {toolResult.error || toolResult.output}
          </pre>
        </div>
      )}
    </div>
  );
};

/**
 * Streaming indicator component
 * 流式输出指示器组件
 */
const StreamingIndicator: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      className="
        flex items-center gap-2
        text-sm text-gray-500 dark:text-gray-400
        mt-2
      "
      data-testid="streaming-indicator"
    >
      <div className="flex gap-1">
        <span
          className="
            w-2 h-2 rounded-full
            bg-blue-500 dark:bg-blue-400
            animate-bounce
          "
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="
            w-2 h-2 rounded-full
            bg-blue-500 dark:bg-blue-400
            animate-bounce
          "
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="
            w-2 h-2 rounded-full
            bg-blue-500 dark:bg-blue-400
            animate-bounce
          "
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span>{t('message.streaming')}</span>
    </div>
  );
};

/**
 * Get the role label for display
 * 获取角色标签用于显示
 */
function getRoleLabel(role: Message['role'], t: (key: string) => string): string {
  switch (role) {
    case 'user':
      return t('message.user');
    case 'assistant':
      return t('message.assistant');
    case 'system':
      return t('message.system');
    case 'tool':
      return t('message.tool');
    default:
      return role;
  }
}

/**
 * MessageItem component
 * 消息展示组件
 *
 * Displays a single message with appropriate styling based on the role.
 * User messages are right-aligned with a different background color.
 * Assistant messages are left-aligned and support Markdown rendering.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered message item / 渲染后的消息项
 *
 * @requirements 3.1 - 区分显示用户消息和 AI 助手消息
 * @requirements 3.4 - 显示工具名称、参数和执行结果
 * @requirements 3.5 - 显示流式输出并指示加载状态
 */
export const MessageItem: React.FC<MessageItemProps> = ({ message, isStreaming = false }) => {
  const { t } = useTranslation();

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem = message.role === 'system';

  // Find tool results for each tool call
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResult>();
    if (message.toolResults) {
      for (const result of message.toolResults) {
        map.set(result.toolCallId, result);
      }
    }
    return map;
  }, [message.toolResults]);

  // Format timestamp
  const formattedTime = useMemo(() => {
    const date = new Date(message.createdAt);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [message.createdAt]);

  return (
    <div
      className={`
        flex flex-col
        ${isUser ? 'items-end' : 'items-start'}
        mb-4
      `}
      data-testid="message-item"
      data-role={message.role}
    >
      {/* Message header with role and time */}
      <div
        className={`
          flex items-center gap-2 mb-1
          text-xs text-gray-500 dark:text-gray-400
          ${isUser ? 'flex-row-reverse' : 'flex-row'}
        `}
      >
        <span className="font-medium" data-testid="message-role">
          {getRoleLabel(message.role, t)}
        </span>
        <span data-testid="message-time">{formattedTime}</span>
      </div>

      {/* Message content */}
      <div
        className={`
          max-w-[85%] rounded-lg px-4 py-3
          ${isUser
            ? 'bg-blue-500 dark:bg-blue-600 text-white'
            : isSystem
              ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          }
        `}
        data-testid="message-content"
      >
        {/* Message text content */}
        {message.content && (
          <div data-testid="message-text">
            {isUser ? (
              // User messages: plain text with whitespace preserved
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              // Assistant/System messages: Markdown rendering
              <MarkdownRenderer content={message.content} />
            )}
          </div>
        )}

        {/* Tool calls display */}
        {isAssistant && message.toolCalls && message.toolCalls.length > 0 && (
          <div data-testid="tool-calls-container">
            {message.toolCalls.map((toolCall) => (
              <ToolCallDisplay
                key={toolCall.id}
                toolCall={toolCall}
                toolResult={toolResultsMap.get(toolCall.id)}
              />
            ))}
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && isAssistant && <StreamingIndicator />}
      </div>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default MessageItem;
