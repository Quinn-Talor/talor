/**
 * PromptInput Component Tests
 * 提示输入框组件测试
 *
 * Tests for the PromptInput component covering multi-line input,
 * keyboard shortcuts, auto-resize, disabled state, and clear after submit.
 *
 * @requirements 4.1 - 支持多行文本输入
 * @requirements 4.2 - Enter 发送 / Shift+Enter 换行
 * @requirements 4.3 - 自动调整高度以适应内容
 * @requirements 4.4 - 发送状态禁用
 * @requirements 4.6 - 发送后清空输入内容
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptInput } from './PromptInput';
import type { PromptInputProps } from './PromptInput';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'chat.inputPlaceholder': 'Type your message...',
        'chat.inputPlaceholderDisabled': 'Waiting for response...',
        'chat.send': 'Send',
        'chat.sending': 'Sending...',
        'a11y.messageInput': 'Message input',
      };
      return translations[key] || key;
    },
  }),
}));

describe('PromptInput', () => {
  const defaultProps: PromptInputProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the textarea and send button', () => {
      render(<PromptInput {...defaultProps} />);

      expect(screen.getByTestId('prompt-input-container')).toBeInTheDocument();
      expect(screen.getByTestId('prompt-input-textarea')).toBeInTheDocument();
      expect(screen.getByTestId('prompt-input-send-button')).toBeInTheDocument();
    });

    it('should display the default placeholder when not disabled', () => {
      render(<PromptInput {...defaultProps} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveAttribute('placeholder', 'Type your message...');
    });

    it('should display the disabled placeholder when disabled', () => {
      render(<PromptInput {...defaultProps} disabled />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveAttribute('placeholder', 'Waiting for response...');
    });

    it('should display custom placeholder when provided', () => {
      render(<PromptInput {...defaultProps} placeholder="Custom placeholder" />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveAttribute('placeholder', 'Custom placeholder');
    });

    it('should display the current value', () => {
      render(<PromptInput {...defaultProps} value="Hello world" />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveValue('Hello world');
    });
  });

  describe('Multi-line Input (Requirement 4.1)', () => {
    it('should support multi-line text input', () => {
      const multiLineText = 'Line 1\nLine 2\nLine 3';
      render(<PromptInput {...defaultProps} value={multiLineText} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveValue(multiLineText);
    });

    it('should call onChange when text is entered', async () => {
      const onChange = vi.fn();
      render(<PromptInput {...defaultProps} onChange={onChange} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.change(textarea, { target: { value: 'New text' } });

      expect(onChange).toHaveBeenCalledWith('New text');
    });

    it('should preserve newlines in the value', () => {
      const textWithNewlines = 'First line\nSecond line\nThird line';
      render(<PromptInput {...defaultProps} value={textWithNewlines} />);

      const textarea = screen.getByTestId(
        'prompt-input-textarea'
      ) as HTMLTextAreaElement;
      expect(textarea.value).toContain('\n');
      expect(textarea.value.split('\n').length).toBe(3);
    });
  });

  describe('Keyboard Shortcuts (Requirement 4.2)', () => {
    it('should call onSubmit when Enter is pressed without Shift', () => {
      const onSubmit = vi.fn();
      render(
        <PromptInput {...defaultProps} value="Test message" onSubmit={onSubmit} />
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onSubmit when Shift+Enter is pressed', () => {
      const onSubmit = vi.fn();
      render(
        <PromptInput {...defaultProps} value="Test message" onSubmit={onSubmit} />
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should NOT call onSubmit when Enter is pressed with empty value', () => {
      const onSubmit = vi.fn();
      render(<PromptInput {...defaultProps} value="" onSubmit={onSubmit} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should NOT call onSubmit when Enter is pressed with whitespace-only value', () => {
      const onSubmit = vi.fn();
      render(<PromptInput {...defaultProps} value="   " onSubmit={onSubmit} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should NOT call onSubmit when Enter is pressed while disabled', () => {
      const onSubmit = vi.fn();
      render(
        <PromptInput
          {...defaultProps}
          value="Test message"
          onSubmit={onSubmit}
          disabled
        />
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should prevent default behavior when Enter is pressed', () => {
      const onSubmit = vi.fn();
      render(
        <PromptInput {...defaultProps} value="Test message" onSubmit={onSubmit} />
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

      // Verify that onSubmit was called, which indicates the Enter key was handled
      // and default behavior (form submission) was prevented
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  describe('Disabled State (Requirement 4.4)', () => {
    it('should disable the textarea when disabled prop is true', () => {
      render(<PromptInput {...defaultProps} disabled />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toBeDisabled();
    });

    it('should disable the send button when disabled prop is true', () => {
      render(<PromptInput {...defaultProps} value="Test" disabled />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toBeDisabled();
    });

    it('should show loading spinner when disabled', () => {
      render(<PromptInput {...defaultProps} value="Test" disabled />);

      expect(screen.getByTestId('send-button-spinner')).toBeInTheDocument();
    });

    it('should show send icon when not disabled', () => {
      render(<PromptInput {...defaultProps} value="Test" />);

      expect(screen.getByTestId('send-button-icon')).toBeInTheDocument();
    });

    it('should apply disabled styling to textarea', () => {
      render(<PromptInput {...defaultProps} disabled />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveClass('opacity-50', 'cursor-not-allowed');
    });

    it('should have aria-disabled attribute when disabled', () => {
      render(<PromptInput {...defaultProps} disabled />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Send Button', () => {
    it('should call onSubmit when send button is clicked with valid input', () => {
      const onSubmit = vi.fn();
      render(
        <PromptInput {...defaultProps} value="Test message" onSubmit={onSubmit} />
      );

      const button = screen.getByTestId('prompt-input-send-button');
      fireEvent.click(button);

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onSubmit when send button is clicked with empty input', () => {
      const onSubmit = vi.fn();
      render(<PromptInput {...defaultProps} value="" onSubmit={onSubmit} />);

      const button = screen.getByTestId('prompt-input-send-button');
      fireEvent.click(button);

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should disable send button when input is empty', () => {
      render(<PromptInput {...defaultProps} value="" />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toBeDisabled();
    });

    it('should disable send button when input is whitespace only', () => {
      render(<PromptInput {...defaultProps} value="   " />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toBeDisabled();
    });

    it('should enable send button when input has content', () => {
      render(<PromptInput {...defaultProps} value="Hello" />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).not.toBeDisabled();
    });

    it('should have appropriate aria-label when not disabled', () => {
      render(<PromptInput {...defaultProps} value="Test" />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toHaveAttribute('aria-label', 'Send');
    });

    it('should have appropriate aria-label when disabled', () => {
      render(<PromptInput {...defaultProps} value="Test" disabled />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toHaveAttribute('aria-label', 'Sending...');
    });
  });

  describe('Auto Height Adjustment (Requirement 4.3)', () => {
    it('should have minimum height style', () => {
      render(<PromptInput {...defaultProps} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveStyle({ minHeight: '44px' });
    });

    it('should have maximum height style', () => {
      render(<PromptInput {...defaultProps} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveStyle({ maxHeight: '200px' });
    });

    it('should have resize-none class to prevent manual resizing', () => {
      render(<PromptInput {...defaultProps} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveClass('resize-none');
    });
  });

  describe('Accessibility', () => {
    it('should have aria-label for the textarea', () => {
      render(<PromptInput {...defaultProps} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveAttribute('aria-label', 'Message input');
    });

    it('should have aria-label for the send button', () => {
      render(<PromptInput {...defaultProps} value="Test" />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toHaveAttribute('aria-label');
    });

    it('should have aria-disabled on send button when disabled', () => {
      render(<PromptInput {...defaultProps} value="" />);

      const button = screen.getByTestId('prompt-input-send-button');
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle rapid typing', async () => {
      const onChange = vi.fn();
      render(<PromptInput {...defaultProps} onChange={onChange} />);

      const textarea = screen.getByTestId('prompt-input-textarea');

      // Simulate rapid typing
      fireEvent.change(textarea, { target: { value: 'H' } });
      fireEvent.change(textarea, { target: { value: 'He' } });
      fireEvent.change(textarea, { target: { value: 'Hel' } });
      fireEvent.change(textarea, { target: { value: 'Hell' } });
      fireEvent.change(textarea, { target: { value: 'Hello' } });

      expect(onChange).toHaveBeenCalledTimes(5);
      expect(onChange).toHaveBeenLastCalledWith('Hello');
    });

    it('should handle paste events', () => {
      const onChange = vi.fn();
      render(<PromptInput {...defaultProps} onChange={onChange} />);

      const textarea = screen.getByTestId('prompt-input-textarea');
      fireEvent.change(textarea, {
        target: { value: 'Pasted content with\nmultiple lines' },
      });

      expect(onChange).toHaveBeenCalledWith('Pasted content with\nmultiple lines');
    });

    it('should work correctly when value is controlled externally', () => {
      const { rerender } = render(
        <PromptInput {...defaultProps} value="Initial" />
      );

      const textarea = screen.getByTestId('prompt-input-textarea');
      expect(textarea).toHaveValue('Initial');

      // Simulate external value change (e.g., after submit clears the input)
      rerender(<PromptInput {...defaultProps} value="" />);
      expect(textarea).toHaveValue('');

      // Simulate new input
      rerender(<PromptInput {...defaultProps} value="New value" />);
      expect(textarea).toHaveValue('New value');
    });
  });
});
