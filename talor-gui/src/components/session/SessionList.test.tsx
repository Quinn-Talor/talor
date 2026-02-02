/**
 * SessionList and SessionItem Component Tests
 * 会话列表和会话项组件测试
 *
 * Tests for the SessionList and SessionItem components including:
 * - Session display
 * - Session selection
 * - Session deletion
 * - Session renaming
 * - Session sorting
 *
 * @requirements 2.1 - 创建新会话并切换到该会话
 * @requirements 2.2 - 选择现有会话加载消息历史
 * @requirements 2.3 - 删除会话并从列表中移除
 * @requirements 2.4 - 显示会话的标题、创建时间和最后更新时间
 * @requirements 2.5 - 按最后更新时间降序排列
 * @requirements 2.6 - 重命名会话并持久化
 *
 * @property 5 - 会话删除后列表更新
 * @property 6 - 会话列表排序
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import type { SessionInfo } from '../../types/session';
import { SessionList, sortSessionsByUpdatedAt } from './SessionList';
import { SessionItem, formatRelativeTime } from './SessionItem';

/**
 * Test wrapper component with i18n provider
 * 带有 i18n 提供者的测试包装组件
 */
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

/**
 * Mock session data for testing
 * 用于测试的模拟会话数据
 */
const mockSessions: SessionInfo[] = [
  {
    id: 'session-1',
    title: 'First Session',
    createdAt: Date.now() - 86400000, // 1 day ago
    updatedAt: Date.now() - 3600000, // 1 hour ago
    messageCount: 5,
  },
  {
    id: 'session-2',
    title: 'Second Session',
    createdAt: Date.now() - 172800000, // 2 days ago
    updatedAt: Date.now() - 60000, // 1 minute ago
    messageCount: 10,
  },
  {
    id: 'session-3',
    title: 'Third Session',
    createdAt: Date.now() - 259200000, // 3 days ago
    updatedAt: Date.now() - 7200000, // 2 hours ago
    messageCount: 3,
  },
];

describe('sortSessionsByUpdatedAt', () => {
  /**
   * Test: Sessions should be sorted by updatedAt in descending order
   * 测试：会话应按 updatedAt 降序排序
   *
   * **Validates: Requirements 2.5**
   * @property 6 - 会话列表排序
   */
  it('should sort sessions by updatedAt in descending order', () => {
    const unsortedSessions = [...mockSessions];
    const sorted = sortSessionsByUpdatedAt(unsortedSessions);

    // Verify descending order
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].updatedAt).toBeGreaterThanOrEqual(sorted[i].updatedAt);
    }
  });

  it('should return empty array for empty input', () => {
    const sorted = sortSessionsByUpdatedAt([]);
    expect(sorted).toEqual([]);
  });

  it('should handle single session', () => {
    const singleSession = [mockSessions[0]];
    const sorted = sortSessionsByUpdatedAt(singleSession);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe('session-1');
  });

  it('should not mutate the original array', () => {
    const original = [...mockSessions];
    const originalOrder = original.map((s) => s.id);
    sortSessionsByUpdatedAt(original);
    expect(original.map((s) => s.id)).toEqual(originalOrder);
  });
});

describe('formatRelativeTime', () => {
  const mockT = (key: string, options?: Record<string, unknown>) => {
    if (key === 'time.now') return 'Just now';
    if (key === 'time.minutesAgo') return `${options?.count} minutes ago`;
    if (key === 'time.hoursAgo') return `${options?.count} hours ago`;
    if (key === 'time.daysAgo') return `${options?.count} days ago`;
    return key;
  };

  it('should return "Just now" for recent timestamps', () => {
    const result = formatRelativeTime(Date.now() - 30000, mockT); // 30 seconds ago
    expect(result).toBe('Just now');
  });

  it('should return minutes ago for timestamps within an hour', () => {
    const result = formatRelativeTime(Date.now() - 300000, mockT); // 5 minutes ago
    expect(result).toBe('5 minutes ago');
  });

  it('should return hours ago for timestamps within a day', () => {
    const result = formatRelativeTime(Date.now() - 7200000, mockT); // 2 hours ago
    expect(result).toBe('2 hours ago');
  });

  it('should return days ago for timestamps within a week', () => {
    const result = formatRelativeTime(Date.now() - 172800000, mockT); // 2 days ago
    expect(result).toBe('2 days ago');
  });
});

describe('SessionItem', () => {
  const defaultProps = {
    session: mockSessions[0],
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test: Session item should display session title
   * 测试：会话项应显示会话标题
   *
   * **Validates: Requirements 2.4**
   */
  it('should display session title', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('First Session')).toBeInTheDocument();
  });

  /**
   * Test: Session item should display message count
   * 测试：会话项应显示消息数量
   *
   * **Validates: Requirements 2.4**
   */
  it('should display message count', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} />
      </TestWrapper>
    );

    // The message count should be displayed
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  /**
   * Test: Session selection should call onSelect
   * 测试：选择会话应调用 onSelect
   *
   * **Validates: Requirements 2.2**
   */
  it('should call onSelect when clicked', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} />
      </TestWrapper>
    );

    // Find the session item by its aria-label
    const sessionItem = screen.getByLabelText(/First Session/);
    fireEvent.click(sessionItem);

    expect(defaultProps.onSelect).toHaveBeenCalledWith('session-1');
  });

  /**
   * Test: Selected session should have different styling
   * 测试：选中的会话应有不同的样式
   */
  it('should apply selected styling when isSelected is true', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Find the session item by its aria-label
    const sessionItem = screen.getByLabelText(/First Session/);
    expect(sessionItem).toHaveAttribute('aria-selected', 'true');
    expect(sessionItem.className).toContain('bg-blue-50');
  });

  /**
   * Test: Delete button should show confirmation
   * 测试：删除按钮应显示确认
   *
   * **Validates: Requirements 2.3**
   */
  it('should show delete confirmation when delete button is clicked', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Find and click the delete button
    const deleteButton = screen.getByTitle('Delete Session');
    fireEvent.click(deleteButton);

    // Confirmation should be shown
    expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
  });

  /**
   * Test: Confirming delete should call onDelete
   * 测试：确认删除应调用 onDelete
   *
   * **Validates: Requirements 2.3**
   * @property 5 - 会话删除后列表更新
   */
  it('should call onDelete when delete is confirmed', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Click delete button
    const deleteButton = screen.getByTitle('Delete Session');
    fireEvent.click(deleteButton);

    // Click confirm button
    const confirmButtons = screen.getAllByRole('button');
    const confirmButton = confirmButtons.find(
      (btn) => btn.getAttribute('aria-label') === 'Confirm'
    );
    expect(confirmButton).toBeDefined();
    fireEvent.click(confirmButton!);

    expect(defaultProps.onDelete).toHaveBeenCalledWith('session-1');
  });

  /**
   * Test: Canceling delete should not call onDelete
   * 测试：取消删除不应调用 onDelete
   */
  it('should not call onDelete when delete is canceled', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Click delete button
    const deleteButton = screen.getByTitle('Delete Session');
    fireEvent.click(deleteButton);

    // Click cancel button
    const cancelButtons = screen.getAllByRole('button');
    const cancelButton = cancelButtons.find(
      (btn) => btn.getAttribute('aria-label') === 'Cancel'
    );
    expect(cancelButton).toBeDefined();
    fireEvent.click(cancelButton!);

    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });

  /**
   * Test: Edit button should enable rename mode
   * 测试：编辑按钮应启用重命名模式
   *
   * **Validates: Requirements 2.6**
   */
  it('should enter edit mode when edit button is clicked', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Find and click the edit button
    const editButton = screen.getByTitle('Rename Session');
    fireEvent.click(editButton);

    // Input should be visible
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('First Session');
  });

  /**
   * Test: Pressing Enter should confirm rename
   * 测试：按 Enter 应确认重命名
   *
   * **Validates: Requirements 2.6**
   */
  it('should call onRename when Enter is pressed in edit mode', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Enter edit mode
    const editButton = screen.getByTitle('Rename Session');
    fireEvent.click(editButton);

    // Change the title
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(defaultProps.onRename).toHaveBeenCalledWith('session-1', 'New Title');
  });

  /**
   * Test: Pressing Escape should cancel rename
   * 测试：按 Escape 应取消重命名
   */
  it('should cancel edit mode when Escape is pressed', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Enter edit mode
    const editButton = screen.getByTitle('Rename Session');
    fireEvent.click(editButton);

    // Change the title and press Escape
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    // Should not call onRename
    expect(defaultProps.onRename).not.toHaveBeenCalled();

    // Should exit edit mode
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  /**
   * Test: Should not rename if title is unchanged
   * 测试：如果标题未更改则不应重命名
   */
  it('should not call onRename if title is unchanged', () => {
    render(
      <TestWrapper>
        <SessionItem {...defaultProps} isSelected={true} />
      </TestWrapper>
    );

    // Enter edit mode
    const editButton = screen.getByTitle('Rename Session');
    fireEvent.click(editButton);

    // Press Enter without changing
    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(defaultProps.onRename).not.toHaveBeenCalled();
  });

  /**
   * Test: Should display untitled for empty title
   * 测试：空标题应显示"未命名"
   */
  it('should display untitled for empty title', () => {
    const sessionWithEmptyTitle = {
      ...mockSessions[0],
      title: '',
    };

    render(
      <TestWrapper>
        <SessionItem {...defaultProps} session={sessionWithEmptyTitle} />
      </TestWrapper>
    );

    expect(screen.getByText('Untitled Session')).toBeInTheDocument();
  });
});

describe('SessionList', () => {
  const defaultProps = {
    sessions: mockSessions,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Test: Should display all sessions
   * 测试：应显示所有会话
   *
   * **Validates: Requirements 2.4**
   */
  it('should display all sessions', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} />
      </TestWrapper>
    );

    expect(screen.getByText('First Session')).toBeInTheDocument();
    expect(screen.getByText('Second Session')).toBeInTheDocument();
    expect(screen.getByText('Third Session')).toBeInTheDocument();
  });

  /**
   * Test: Sessions should be sorted by updatedAt descending
   * 测试：会话应按 updatedAt 降序排序
   *
   * **Validates: Requirements 2.5**
   * @property 6 - 会话列表排序
   */
  it('should display sessions sorted by updatedAt in descending order', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} />
      </TestWrapper>
    );

    const sessionItems = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-selected') !== null
    );

    // Second Session (most recent) should be first
    // First Session should be second
    // Third Session (oldest) should be last
    expect(sessionItems[0]).toHaveTextContent('Second Session');
    expect(sessionItems[1]).toHaveTextContent('First Session');
    expect(sessionItems[2]).toHaveTextContent('Third Session');
  });

  /**
   * Test: Should highlight current session
   * 测试：应高亮当前会话
   */
  it('should highlight the current session', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} currentSessionId="session-2" />
      </TestWrapper>
    );

    const sessionItems = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('aria-selected') !== null
    );

    const selectedItem = sessionItems.find(
      (item) => item.getAttribute('aria-selected') === 'true'
    );
    expect(selectedItem).toHaveTextContent('Second Session');
  });

  /**
   * Test: Should call onCreate when new session button is clicked
   * 测试：点击新建会话按钮时应调用 onCreate
   *
   * **Validates: Requirements 2.1**
   */
  it('should call onCreate when new session button is clicked', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} />
      </TestWrapper>
    );

    const newSessionButton = screen.getByText('New Session');
    fireEvent.click(newSessionButton);

    expect(defaultProps.onCreate).toHaveBeenCalled();
  });

  /**
   * Test: Should show empty state when no sessions
   * 测试：无会话时应显示空状态
   */
  it('should show empty state when no sessions', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} sessions={[]} />
      </TestWrapper>
    );

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByText('Start a new conversation')).toBeInTheDocument();
  });

  /**
   * Test: Should show loading state
   * 测试：应显示加载状态
   */
  it('should show loading state when isLoading is true and no sessions', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} sessions={[]} isLoading={true} />
      </TestWrapper>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  /**
   * Test: Should call onSelect when session is clicked
   * 测试：点击会话时应调用 onSelect
   *
   * **Validates: Requirements 2.2**
   */
  it('should call onSelect when a session is clicked', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} />
      </TestWrapper>
    );

    const sessionItem = screen.getByText('First Session');
    fireEvent.click(sessionItem);

    expect(defaultProps.onSelect).toHaveBeenCalledWith('session-1');
  });

  /**
   * Test: Should call onDelete when session delete is confirmed
   * 测试：确认删除会话时应调用 onDelete
   *
   * **Validates: Requirements 2.3**
   * @property 5 - 会话删除后列表更新
   */
  it('should call onDelete when session delete is confirmed', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} currentSessionId="session-1" />
      </TestWrapper>
    );

    // Find the delete button for the selected session (first one in sorted order is session-2, session-1 is second)
    const deleteButtons = screen.getAllByTitle('Delete Session');
    // session-1 is the second item after sorting (session-2 is first due to more recent updatedAt)
    fireEvent.click(deleteButtons[1]);

    // Confirm deletion
    const confirmButtons = screen.getAllByRole('button');
    const confirmButton = confirmButtons.find(
      (btn) => btn.getAttribute('aria-label') === 'Confirm'
    );
    fireEvent.click(confirmButton!);

    expect(defaultProps.onDelete).toHaveBeenCalledWith('session-1');
  });

  /**
   * Test: Should call onRename when session is renamed
   * 测试：重命名会话时应调用 onRename
   *
   * **Validates: Requirements 2.6**
   */
  it('should call onRename when session is renamed', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} currentSessionId="session-1" />
      </TestWrapper>
    );

    // Find the edit button for the selected session (session-1 is second after sorting)
    const editButtons = screen.getAllByTitle('Rename Session');
    fireEvent.click(editButtons[1]);

    // Change the title
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed Session' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(defaultProps.onRename).toHaveBeenCalledWith('session-1', 'Renamed Session');
  });

  /**
   * Test: Empty state should have create button
   * 测试：空状态应有创建按钮
   */
  it('should have create button in empty state', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} sessions={[]} />
      </TestWrapper>
    );

    // Find the create button in empty state
    const createButtons = screen.getAllByText('New Session');
    expect(createButtons.length).toBeGreaterThan(0);

    // Click the button in empty state (the second one)
    fireEvent.click(createButtons[createButtons.length - 1]);

    expect(defaultProps.onCreate).toHaveBeenCalled();
  });

  /**
   * Test: New session button should be disabled when loading
   * 测试：加载时新建会话按钮应被禁用
   */
  it('should disable new session button when loading', () => {
    render(
      <TestWrapper>
        <SessionList {...defaultProps} isLoading={true} />
      </TestWrapper>
    );

    const newSessionButtons = screen.getAllByText('New Session');
    // The header button should be disabled
    expect(newSessionButtons[0].closest('button')).toBeDisabled();
  });
});
