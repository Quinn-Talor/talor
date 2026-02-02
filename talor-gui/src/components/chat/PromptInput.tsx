/**
 * PromptInput Component
 * 提示输入框组件
 *
 * A multi-line input component for entering prompts with auto-resize,
 * keyboard shortcuts (Enter to send, Shift+Enter for newline),
 * disabled state support, and clear after submit functionality.
 *
 * @requirements 4.1 - 支持多行文本输入
 * @requirements 4.2 - Enter 发送 / Shift+Enter 换行
 * @requirements 4.3 - 自动调整高度以适应内容
 * @requirements 4.4 - 发送状态禁用
 * @requirements 4.6 - 发送后清空输入内容
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Props for the PromptInput component
 * PromptInput 组件的属性
 */
export interface PromptInputProps {
  /** Current input value / 当前输入值 */
  value: string;
  /** Callback when value changes / 值变化时的回调 */
  onChange: (value: string) => void;
  /** Callback when user submits / 用户提交时的回调 */
  onSubmit: () => void;
  /** Whether the input is disabled / 是否禁用输入 */
  disabled?: boolean;
  /** Placeholder text / 占位符文本 */
  placeholder?: string;
}

/**
 * Minimum height for the textarea in pixels
 * 文本框的最小高度（像素）
 */
const MIN_HEIGHT = 44;

/**
 * Maximum height for the textarea in pixels
 * 文本框的最大高度（像素）
 */
const MAX_HEIGHT = 200;

/**
 * PromptInput component
 * 提示输入框组件
 *
 * Provides a multi-line textarea with auto-resize functionality,
 * keyboard shortcuts for sending messages, and disabled state support.
 *
 * @param props - Component props / 组件属性
 * @returns Rendered prompt input / 渲染后的提示输入框
 *
 * @requirements 4.1 - 支持多行文本输入
 * @requirements 4.2 - Enter 发送 / Shift+Enter 换行
 * @requirements 4.3 - 自动调整高度以适应内容
 * @requirements 4.4 - 发送状态禁用
 * @requirements 4.6 - 发送后清空输入内容
 */
export const PromptInput: React.FC<PromptInputProps> = ({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder,
}) => {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Get the appropriate placeholder text
   * 获取适当的占位符文本
   */
  const getPlaceholder = useCallback(() => {
    if (placeholder) {
      return placeholder;
    }
    return disabled
      ? t('chat.inputPlaceholderDisabled')
      : t('chat.inputPlaceholder');
  }, [placeholder, disabled, t]);

  /**
   * Adjust textarea height based on content
   * 根据内容调整文本框高度
   *
   * @requirements 4.3 - 自动调整高度以适应内容
   */
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Calculate new height within bounds
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(Math.max(scrollHeight, MIN_HEIGHT), MAX_HEIGHT);

    textarea.style.height = `${newHeight}px`;

    // Enable scrolling if content exceeds max height
    textarea.style.overflowY = scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  /**
   * Adjust height when value changes
   * 值变化时调整高度
   */
  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  /**
   * Handle input change
   * 处理输入变化
   *
   * @param event - Change event / 变化事件
   * @requirements 4.1 - 支持多行文本输入
   */
  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
    [onChange]
  );

  /**
   * Handle keyboard events
   * 处理键盘事件
   *
   * @param event - Keyboard event / 键盘事件
   * @requirements 4.2 - Enter 发送 / Shift+Enter 换行
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter without Shift triggers submit
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();

        // Only submit if not disabled and has content
        if (!disabled && value.trim()) {
          onSubmit();
        }
      }
      // Shift+Enter allows default behavior (newline)
    },
    [disabled, value, onSubmit]
  );

  /**
   * Handle send button click
   * 处理发送按钮点击
   *
   * @requirements 4.4 - 发送状态禁用
   * @requirements 4.6 - 发送后清空输入内容
   */
  const handleSendClick = useCallback(() => {
    if (!disabled && value.trim()) {
      onSubmit();
    }
  }, [disabled, value, onSubmit]);

  /**
   * Check if send button should be disabled
   * 检查发送按钮是否应该禁用
   */
  const isSendDisabled = disabled || !value.trim();

  return (
    <div
      className="
        flex items-end gap-2
        p-3
        bg-white dark:bg-gray-800
        border-t border-gray-200 dark:border-gray-700
      "
      data-testid="prompt-input-container"
    >
      {/* Textarea */}
      <div className="flex-1 relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={getPlaceholder()}
          rows={1}
          className={`
            w-full
            px-4 py-3
            bg-gray-100 dark:bg-gray-700
            border border-gray-200 dark:border-gray-600
            rounded-lg
            text-gray-900 dark:text-gray-100
            placeholder-gray-500 dark:placeholder-gray-400
            resize-none
            focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
            focus:border-transparent
            transition-colors duration-200
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={{
            minHeight: `${MIN_HEIGHT}px`,
            maxHeight: `${MAX_HEIGHT}px`,
          }}
          data-testid="prompt-input-textarea"
          aria-label={t('a11y.messageInput')}
          aria-disabled={disabled}
        />
      </div>

      {/* Send button */}
      <button
        type="button"
        onClick={handleSendClick}
        disabled={isSendDisabled}
        className={`
          flex items-center justify-center
          w-11 h-11
          rounded-lg
          transition-colors duration-200
          ${
            isSendDisabled
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
              : 'bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-700'
          }
        `}
        data-testid="prompt-input-send-button"
        aria-label={disabled ? t('chat.sending') : t('chat.send')}
        aria-disabled={isSendDisabled}
      >
        {disabled ? (
          // Loading spinner when disabled/sending
          <svg
            className="w-5 h-5 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
            data-testid="send-button-spinner"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          // Send icon
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
            data-testid="send-button-icon"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        )}
      </button>
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default PromptInput;
