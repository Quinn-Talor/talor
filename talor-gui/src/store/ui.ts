/**
 * UI State Store
 * UI 状态 Store
 *
 * Manages UI-related transient state using Zustand, including sidebar
 * collapsed state, loading states, and permission dialog state.
 *
 * @requirements 9.3 - 支持侧边栏的展开和折叠
 * @requirements 5.1 - 显示权限请求详情
 * @requirements 1.3 - 自动尝试重新连接并显示连接状态
 */

import { create } from 'zustand';
import type { PermissionRequest } from '../types/permission';
import type { ConnectionState } from '../api/events';

export type { ConnectionState } from '../api/events';

/**
 * Loading state keys
 * 加载状态键
 */
export type LoadingKey =
  | 'sessions'
  | 'messages'
  | 'settings'
  | 'models'
  | 'tools'
  | 'global';

/**
 * UI state interface
 * UI 状态接口
 */
export interface UIState {
  /** Whether the sidebar is collapsed / 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  /** Loading states by key / 按键索引的加载状态 */
  loadingStates: Record<LoadingKey, boolean>;
  /** Current permission request being displayed / 当前显示的权限请求 */
  currentPermissionRequest: PermissionRequest | null;
  /** Whether the permission dialog is visible / 权限对话框是否可见 */
  permissionDialogVisible: boolean;
  /** Whether the settings panel is open / 设置面板是否打开 */
  settingsPanelOpen: boolean;
  /** Current notification message / 当前通知消息 */
  notification: UINotification | null;
  /** Connection state to the backend / 与后端的连接状态 */
  connectionState: ConnectionState;
  /** Connection retry count / 连接重试次数 */
  connectionRetryCount: number;
}

/**
 * UI notification interface
 * UI 通知接口
 */
export interface UINotification {
  /** Notification ID / 通知 ID */
  id: string;
  /** Notification type / 通知类型 */
  type: 'info' | 'success' | 'warning' | 'error';
  /** Notification message / 通知消息 */
  message: string;
  /** Auto-dismiss duration in ms (0 = no auto-dismiss) / 自动关闭时间（毫秒，0 = 不自动关闭） */
  duration?: number;
}

/**
 * UI actions interface
 * UI 操作接口
 */
export interface UIActions {
  /**
   * Toggles the sidebar collapsed state
   * 切换侧边栏折叠状态
   */
  toggleSidebar(): void;

  /**
   * Sets the sidebar collapsed state
   * 设置侧边栏折叠状态
   *
   * @param collapsed - Whether the sidebar should be collapsed / 侧边栏是否应该折叠
   */
  setSidebarCollapsed(collapsed: boolean): void;

  /**
   * Sets a loading state
   * 设置加载状态
   *
   * @param key - The loading state key / 加载状态键
   * @param isLoading - Whether it's loading / 是否正在加载
   */
  setLoading(key: LoadingKey, isLoading: boolean): void;

  /**
   * Checks if a specific key is loading
   * 检查特定键是否正在加载
   *
   * @param key - The loading state key / 加载状态键
   * @returns Whether the key is loading / 该键是否正在加载
   */
  isLoading(key: LoadingKey): boolean;

  /**
   * Checks if any loading state is active
   * 检查是否有任何加载状态处于活动状态
   *
   * @returns Whether any loading state is active / 是否有任何加载状态处于活动状态
   */
  isAnyLoading(): boolean;

  /**
   * Shows a permission request dialog
   * 显示权限请求对话框
   *
   * @param request - The permission request to display / 要显示的权限请求
   */
  showPermissionDialog(request: PermissionRequest): void;

  /**
   * Hides the permission dialog
   * 隐藏权限对话框
   */
  hidePermissionDialog(): void;

  /**
   * Opens the settings panel
   * 打开设置面板
   */
  openSettingsPanel(): void;

  /**
   * Closes the settings panel
   * 关闭设置面板
   */
  closeSettingsPanel(): void;

  /**
   * Toggles the settings panel
   * 切换设置面板
   */
  toggleSettingsPanel(): void;

  /**
   * Shows a notification
   * 显示通知
   *
   * @param notification - The notification to show (without id) / 要显示的通知（不含 id）
   */
  showNotification(notification: Omit<UINotification, 'id'>): void;

  /**
   * Hides the current notification
   * 隐藏当前通知
   */
  hideNotification(): void;

  /**
   * Resets all UI state to defaults
   * 重置所有 UI 状态为默认值
   */
  resetUIState(): void;

  /**
   * Sets the connection state
   * 设置连接状态
   *
   * @param state - The connection state / 连接状态
   * @param retryCount - Optional retry count / 可选的重试次数
   */
  setConnectionState(state: ConnectionState, retryCount?: number): void;

  /**
   * Gets the current connection state
   * 获取当前连接状态
   *
   * @returns Current connection state / 当前连接状态
   */
  getConnectionState(): ConnectionState;
}

/**
 * Combined UI store type
 * 组合的 UI store 类型
 */
export type UIStore = UIState & UIActions;

/**
 * Initial loading states
 * 初始加载状态
 */
const initialLoadingStates: Record<LoadingKey, boolean> = {
  sessions: false,
  messages: false,
  settings: false,
  models: false,
  tools: false,
  global: false,
};

/**
 * Initial state for the UI store
 * UI store 的初始状态
 */
const initialState: UIState = {
  sidebarCollapsed: false,
  loadingStates: { ...initialLoadingStates },
  currentPermissionRequest: null,
  permissionDialogVisible: false,
  settingsPanelOpen: false,
  notification: null,
  connectionState: 'disconnected',
  connectionRetryCount: 0,
};

/**
 * Generates a unique notification ID
 * 生成唯一的通知 ID
 *
 * @returns Unique notification ID / 唯一的通知 ID
 */
function generateNotificationId(): string {
  return `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Creates the UI store
 * 创建 UI store
 */
export const useUIStore = create<UIStore>((set, get) => ({
  // Initial state
  ...initialState,

  /**
   * Toggles the sidebar collapsed state
   * 切换侧边栏折叠状态
   *
   * @requirements 9.3 - 支持侧边栏的展开和折叠
   */
  toggleSidebar(): void {
    set((state) => ({
      sidebarCollapsed: !state.sidebarCollapsed,
    }));
  },

  /**
   * Sets the sidebar collapsed state
   * 设置侧边栏折叠状态
   *
   * @requirements 9.3 - 支持侧边栏的展开和折叠
   */
  setSidebarCollapsed(collapsed: boolean): void {
    set({ sidebarCollapsed: collapsed });
  },

  /**
   * Sets a loading state
   * 设置加载状态
   */
  setLoading(key: LoadingKey, isLoading: boolean): void {
    set((state) => ({
      loadingStates: {
        ...state.loadingStates,
        [key]: isLoading,
      },
    }));
  },

  /**
   * Checks if a specific key is loading
   * 检查特定键是否正在加载
   */
  isLoading(key: LoadingKey): boolean {
    return get().loadingStates[key] ?? false;
  },

  /**
   * Checks if any loading state is active
   * 检查是否有任何加载状态处于活动状态
   */
  isAnyLoading(): boolean {
    const { loadingStates } = get();
    return Object.values(loadingStates).some((loading) => loading);
  },

  /**
   * Shows a permission request dialog
   * 显示权限请求对话框
   *
   * @requirements 5.1 - 显示权限请求详情
   */
  showPermissionDialog(request: PermissionRequest): void {
    set({
      currentPermissionRequest: request,
      permissionDialogVisible: true,
    });
  },

  /**
   * Hides the permission dialog
   * 隐藏权限对话框
   */
  hidePermissionDialog(): void {
    set({
      currentPermissionRequest: null,
      permissionDialogVisible: false,
    });
  },

  /**
   * Opens the settings panel
   * 打开设置面板
   */
  openSettingsPanel(): void {
    set({ settingsPanelOpen: true });
  },

  /**
   * Closes the settings panel
   * 关闭设置面板
   */
  closeSettingsPanel(): void {
    set({ settingsPanelOpen: false });
  },

  /**
   * Toggles the settings panel
   * 切换设置面板
   */
  toggleSettingsPanel(): void {
    set((state) => ({
      settingsPanelOpen: !state.settingsPanelOpen,
    }));
  },

  /**
   * Shows a notification
   * 显示通知
   */
  showNotification(notification: Omit<UINotification, 'id'>): void {
    const fullNotification: UINotification = {
      ...notification,
      id: generateNotificationId(),
    };
    set({ notification: fullNotification });
  },

  /**
   * Hides the current notification
   * 隐藏当前通知
   */
  hideNotification(): void {
    set({ notification: null });
  },

  /**
   * Resets all UI state to defaults
   * 重置所有 UI 状态为默认值
   */
  resetUIState(): void {
    set(initialState);
  },

  /**
   * Sets the connection state
   * 设置连接状态
   *
   * @requirements 1.3 - 自动尝试重新连接并显示连接状态
   */
  setConnectionState(state: ConnectionState, retryCount?: number): void {
    set({
      connectionState: state,
      connectionRetryCount: retryCount ?? get().connectionRetryCount,
    });
  },

  /**
   * Gets the current connection state
   * 获取当前连接状态
   */
  getConnectionState(): ConnectionState {
    return get().connectionState;
  },
}));

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default useUIStore;
