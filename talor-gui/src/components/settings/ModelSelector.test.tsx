/**
 * ModelSelector Component Tests
 * 模型选择组件测试
 *
 * Tests for the ModelSelector component that displays and allows
 * selection of LLM models grouped by provider.
 *
 * @requirements 7.1 - 显示所有可用的 LLM 模型列表
 * @requirements 7.2 - 按提供商分组显示模型
 * @requirements 7.3 - 用户选择模型时更新当前会话使用的模型
 * @requirements 7.4 - 显示模型的基本信息（名称、提供商、能力）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModelSelector } from './ModelSelector';
import type { ModelSelectorProps } from './ModelSelector';
import type { ModelInfo } from '../../types/config';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'model.title': 'Model',
        'model.select': 'Select Model',
        'model.current': 'Current Model',
        'model.noModels': 'No models available',
        'model.loadingModels': 'Loading models...',
        'model.provider': 'Provider',
        'model.capabilities': 'Capabilities',
        'model.unavailable': 'Model unavailable',
        'model.setDefault': 'Set as Default',
        'model.default': 'Default',
        'settings.provider.addFirst': 'Add a provider to get started',
      };
      return translations[key] || key;
    },
  }),
}));

describe('ModelSelector', () => {
  const mockModels: ModelInfo[] = [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      providerId: 'openai',
      providerName: 'OpenAI',
      capabilities: ['chat', 'code', 'vision'],
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      providerId: 'openai',
      providerName: 'OpenAI',
      capabilities: ['chat', 'code'],
    },
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      capabilities: ['chat', 'code', 'vision', 'analysis'],
    },
    {
      id: 'claude-3-sonnet',
      name: 'Claude 3 Sonnet',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      capabilities: ['chat', 'code'],
    },
  ];

  const defaultProps: ModelSelectorProps = {
    models: mockModels,
    selectedModel: undefined,
    onSelect: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the component with title', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });

    it('should render empty state when no models', () => {
      render(<ModelSelector {...defaultProps} models={[]} />);

      expect(screen.getByTestId('model-selector-empty')).toBeInTheDocument();
      expect(screen.getByText('No models available')).toBeInTheDocument();
      expect(screen.getByText('Add a provider to get started')).toBeInTheDocument();
    });

    it('should render model list when models exist', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByTestId('model-selector-list')).toBeInTheDocument();
    });

    it('should display all model names', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByText('GPT-4')).toBeInTheDocument();
      expect(screen.getByText('GPT-3.5 Turbo')).toBeInTheDocument();
      expect(screen.getByText('Claude 3 Opus')).toBeInTheDocument();
      expect(screen.getByText('Claude 3 Sonnet')).toBeInTheDocument();
    });
  });

  describe('Provider Grouping', () => {
    it('should group models by provider', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByTestId('model-selector-group-openai')).toBeInTheDocument();
      expect(screen.getByTestId('model-selector-group-anthropic')).toBeInTheDocument();
    });

    it('should display provider names as group headers', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByTestId('model-selector-group-openai-name')).toHaveTextContent('OpenAI');
      expect(screen.getByTestId('model-selector-group-anthropic-name')).toHaveTextContent('Anthropic');
    });

    it('should display model count for each provider', () => {
      render(<ModelSelector {...defaultProps} />);

      // OpenAI has 2 models, Anthropic has 2 models
      expect(screen.getByTestId('model-selector-group-openai')).toHaveTextContent('(2)');
      expect(screen.getByTestId('model-selector-group-anthropic')).toHaveTextContent('(2)');
    });

    it('should render models under their respective provider groups', () => {
      render(<ModelSelector {...defaultProps} />);

      const openaiGroup = screen.getByTestId('model-selector-group-openai');
      const anthropicGroup = screen.getByTestId('model-selector-group-anthropic');

      // Check OpenAI models are in OpenAI group
      expect(openaiGroup).toContainElement(screen.getByTestId('model-selector-item-gpt-4'));
      expect(openaiGroup).toContainElement(screen.getByTestId('model-selector-item-gpt-3.5-turbo'));

      // Check Anthropic models are in Anthropic group
      expect(anthropicGroup).toContainElement(screen.getByTestId('model-selector-item-claude-3-opus'));
      expect(anthropicGroup).toContainElement(screen.getByTestId('model-selector-item-claude-3-sonnet'));
    });
  });

  describe('Model Information Display', () => {
    it('should display model names', () => {
      render(<ModelSelector {...defaultProps} />);

      expect(screen.getByTestId('model-selector-item-gpt-4-name')).toHaveTextContent('GPT-4');
      expect(screen.getByTestId('model-selector-item-claude-3-opus-name')).toHaveTextContent('Claude 3 Opus');
    });

    it('should display model capabilities', () => {
      render(<ModelSelector {...defaultProps} />);

      const gpt4Capabilities = screen.getByTestId('model-selector-item-gpt-4-capabilities');
      expect(gpt4Capabilities).toBeInTheDocument();
      expect(screen.getByTestId('model-selector-item-gpt-4-capability-chat')).toBeInTheDocument();
      expect(screen.getByTestId('model-selector-item-gpt-4-capability-code')).toBeInTheDocument();
      expect(screen.getByTestId('model-selector-item-gpt-4-capability-vision')).toBeInTheDocument();
    });

    it('should handle models with no capabilities', () => {
      const modelsWithNoCapabilities: ModelInfo[] = [
        {
          id: 'basic-model',
          name: 'Basic Model',
          providerId: 'test',
          providerName: 'Test Provider',
          capabilities: [],
        },
      ];

      render(<ModelSelector {...defaultProps} models={modelsWithNoCapabilities} />);

      expect(screen.getByTestId('model-selector-item-basic-model')).toBeInTheDocument();
      expect(screen.queryByTestId('model-selector-item-basic-model-capabilities')).not.toBeInTheDocument();
    });
  });

  describe('Model Selection', () => {
    it('should call onSelect when clicking a model', () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId('model-selector-item-gpt-4'));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('gpt-4');
    });

    it('should call onSelect with correct model ID for different models', () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId('model-selector-item-claude-3-opus'));

      expect(onSelect).toHaveBeenCalledWith('claude-3-opus');
    });

    it('should highlight selected model', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      const selectedItem = screen.getByTestId('model-selector-item-gpt-4');
      expect(selectedItem).toHaveAttribute('aria-selected', 'true');
    });

    it('should not highlight unselected models', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      const unselectedItem = screen.getByTestId('model-selector-item-claude-3-opus');
      expect(unselectedItem).toHaveAttribute('aria-selected', 'false');
    });

    it('should show check icon for selected model', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      expect(screen.getByTestId('model-selector-item-gpt-4-check')).toBeInTheDocument();
    });

    it('should not show check icon for unselected models', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      expect(screen.queryByTestId('model-selector-item-claude-3-opus-check')).not.toBeInTheDocument();
    });

    it('should display current model name when selected', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      expect(screen.getByTestId('model-selector-current')).toHaveTextContent('Current Model: GPT-4');
    });

    it('should not display current model when none selected', () => {
      render(<ModelSelector {...defaultProps} selectedModel={undefined} />);

      expect(screen.queryByTestId('model-selector-current')).not.toBeInTheDocument();
    });
  });

  describe('Keyboard Navigation', () => {
    it('should select model on Enter key', () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);

      const modelItem = screen.getByTestId('model-selector-item-gpt-4');
      fireEvent.keyDown(modelItem, { key: 'Enter' });

      expect(onSelect).toHaveBeenCalledWith('gpt-4');
    });

    it('should select model on Space key', () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);

      const modelItem = screen.getByTestId('model-selector-item-gpt-4');
      fireEvent.keyDown(modelItem, { key: ' ' });

      expect(onSelect).toHaveBeenCalledWith('gpt-4');
    });

    it('should not select model on other keys', () => {
      const onSelect = vi.fn();
      render(<ModelSelector {...defaultProps} onSelect={onSelect} />);

      const modelItem = screen.getByTestId('model-selector-item-gpt-4');
      fireEvent.keyDown(modelItem, { key: 'Tab' });

      expect(onSelect).not.toHaveBeenCalled();
    });

    it('should have tabIndex for keyboard focus', () => {
      render(<ModelSelector {...defaultProps} />);

      const modelItem = screen.getByTestId('model-selector-item-gpt-4');
      expect(modelItem).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('Accessibility', () => {
    it('should have role="option" on model items', () => {
      render(<ModelSelector {...defaultProps} />);

      const modelItem = screen.getByTestId('model-selector-item-gpt-4');
      expect(modelItem).toHaveAttribute('role', 'option');
    });

    it('should have aria-selected attribute on model items', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      expect(screen.getByTestId('model-selector-item-gpt-4')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('model-selector-item-claude-3-opus')).toHaveAttribute('aria-selected', 'false');
    });

    it('should have role="listbox" on model list containers', () => {
      render(<ModelSelector {...defaultProps} />);

      const listboxes = screen.getAllByRole('listbox');
      expect(listboxes.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty models array', () => {
      render(<ModelSelector {...defaultProps} models={[]} />);

      expect(screen.getByTestId('model-selector-empty')).toBeInTheDocument();
    });

    it('should handle single model', () => {
      const singleModel: ModelInfo[] = [mockModels[0]];
      render(<ModelSelector {...defaultProps} models={singleModel} />);

      expect(screen.getByTestId('model-selector-item-gpt-4')).toBeInTheDocument();
      expect(screen.queryByTestId('model-selector-item-claude-3-opus')).not.toBeInTheDocument();
    });

    it('should handle single provider with multiple models', () => {
      const openaiModels = mockModels.filter((m) => m.providerId === 'openai');
      render(<ModelSelector {...defaultProps} models={openaiModels} />);

      expect(screen.getByTestId('model-selector-group-openai')).toBeInTheDocument();
      expect(screen.queryByTestId('model-selector-group-anthropic')).not.toBeInTheDocument();
    });

    it('should handle selected model that does not exist in list', () => {
      render(<ModelSelector {...defaultProps} selectedModel="non-existent-model" />);

      // Should still render without errors
      expect(screen.getByTestId('model-selector')).toBeInTheDocument();
      // Current model should show the ID since name is not found
      expect(screen.getByTestId('model-selector-current')).toHaveTextContent('Current Model: non-existent-model');
    });

    it('should handle models with special characters in ID', () => {
      const specialModels: ModelInfo[] = [
        {
          id: 'model-with-special_chars.v1',
          name: 'Special Model',
          providerId: 'test',
          providerName: 'Test',
          capabilities: [],
        },
      ];
      render(<ModelSelector {...defaultProps} models={specialModels} />);

      expect(screen.getByTestId('model-selector-item-model-with-special_chars.v1')).toBeInTheDocument();
    });

    it('should handle many capabilities', () => {
      const modelWithManyCapabilities: ModelInfo[] = [
        {
          id: 'super-model',
          name: 'Super Model',
          providerId: 'test',
          providerName: 'Test',
          capabilities: ['chat', 'code', 'vision', 'audio', 'video', 'analysis', 'translation'],
        },
      ];
      render(<ModelSelector {...defaultProps} models={modelWithManyCapabilities} />);

      const capabilities = screen.getByTestId('model-selector-item-super-model-capabilities');
      expect(capabilities.children.length).toBe(7);
    });
  });

  describe('Visual States', () => {
    it('should apply different styles to selected vs unselected models', () => {
      render(<ModelSelector {...defaultProps} selectedModel="gpt-4" />);

      const selectedItem = screen.getByTestId('model-selector-item-gpt-4');
      const unselectedItem = screen.getByTestId('model-selector-item-claude-3-opus');

      // Selected item should have blue styling classes
      expect(selectedItem.className).toContain('bg-blue-50');
      expect(selectedItem.className).toContain('border-blue-500');

      // Unselected item should have default styling
      expect(unselectedItem.className).toContain('bg-white');
      expect(unselectedItem.className).not.toContain('border-blue-500');
    });
  });
});
