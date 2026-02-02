/**
 * UI Store Tests
 * UI Store 测试
 *
 * Unit tests for the UI store implementation.
 *
 * @requirements 9.3 - 支持侧边栏的展开和折叠
 * @requirements 5.1 - 显示权限请求详情
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, type LoadingKey, type UINotification } from './ui';
import type { PermissionRequest } from '../types/permission';

/**
 * Creates a mock permission request
 * 创建模拟的权限请求
 */
function createMockPermissionRequest(
  overrides: Partial<PermissionRequest> = {}
): PermissionRequest {
  return {
    id: 'perm-1',
    sessionId: 'session-1',
    toolName: 'file_write',
    arguments: { path: '/test/file.txt', content: 'test content' },
    description: 'Write to file /test/file.txt',
    ...overrides,
  };
}

describe('UI Store', () => {
  beforeEach(() => {
    // Reset the store before each test
    useUIStore.setState({
      sidebarCollapsed: false,
      loadingStates: {
        sessions: false,
        messages: false,
        settings: false,
        models: false,
        tools: false,
        global: false,
      },
      currentPermissionRequest: null,
      permissionDialogVisible: false,
      settingsPanelOpen: false,
      notification: null,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useUIStore.getState();

      expect(state.sidebarCollapsed).toBe(false);
      expect(state.loadingStates.sessions).toBe(false);
      expect(state.loadingStates.messages).toBe(false);
      expect(state.loadingStates.settings).toBe(false);
      expect(state.loadingStates.models).toBe(false);
      expect(state.loadingStates.tools).toBe(false);
      expect(state.loadingStates.global).toBe(false);
      expect(state.currentPermissionRequest).toBeNull();
      expect(state.permissionDialogVisible).toBe(false);
      expect(state.settingsPanelOpen).toBe(false);
      expect(state.notification).toBeNull();
    });
  });

  describe('Sidebar State', () => {
    describe('toggleSidebar', () => {
      it('should toggle sidebar from collapsed to expanded', () => {
        useUIStore.setState({ sidebarCollapsed: true });

        useUIStore.getState().toggleSidebar();

        const state = useUIStore.getState();
        expect(state.sidebarCollapsed).toBe(false);
      });

      it('should toggle sidebar from expanded to collapsed', () => {
        useUIStore.setState({ sidebarCollapsed: false });

        useUIStore.getState().toggleSidebar();

        const state = useUIStore.getState();
        expect(state.sidebarCollapsed).toBe(true);
      });

      it('should toggle sidebar multiple times correctly', () => {
        expect(useUIStore.getState().sidebarCollapsed).toBe(false);

        useUIStore.getState().toggleSidebar();
        expect(useUIStore.getState().sidebarCollapsed).toBe(true);

        useUIStore.getState().toggleSidebar();
        expect(useUIStore.getState().sidebarCollapsed).toBe(false);

        useUIStore.getState().toggleSidebar();
        expect(useUIStore.getState().sidebarCollapsed).toBe(true);
      });
    });

    describe('setSidebarCollapsed', () => {
      it('should set sidebar to collapsed', () => {
        useUIStore.getState().setSidebarCollapsed(true);

        const state = useUIStore.getState();
        expect(state.sidebarCollapsed).toBe(true);
      });

      it('should set sidebar to expanded', () => {
        useUIStore.setState({ sidebarCollapsed: true });

        useUIStore.getState().setSidebarCollapsed(false);

        const state = useUIStore.getState();
        expect(state.sidebarCollapsed).toBe(false);
      });

      it('should handle setting same value', () => {
        useUIStore.setState({ sidebarCollapsed: true });

        useUIStore.getState().setSidebarCollapsed(true);

        const state = useUIStore.getState();
        expect(state.sidebarCollapsed).toBe(true);
      });
    });
  });

  describe('Loading States', () => {
    describe('setLoading', () => {
      it('should set loading state for sessions', () => {
        useUIStore.getState().setLoading('sessions', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.sessions).toBe(true);
      });

      it('should set loading state for messages', () => {
        useUIStore.getState().setLoading('messages', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.messages).toBe(true);
      });

      it('should set loading state for settings', () => {
        useUIStore.getState().setLoading('settings', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.settings).toBe(true);
      });

      it('should set loading state for models', () => {
        useUIStore.getState().setLoading('models', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.models).toBe(true);
      });

      it('should set loading state for tools', () => {
        useUIStore.getState().setLoading('tools', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.tools).toBe(true);
      });

      it('should set loading state for global', () => {
        useUIStore.getState().setLoading('global', true);

        const state = useUIStore.getState();
        expect(state.loadingStates.global).toBe(true);
      });

      it('should clear loading state', () => {
        useUIStore.setState({
          loadingStates: {
            ...useUIStore.getState().loadingStates,
            sessions: true,
          },
        });

        useUIStore.getState().setLoading('sessions', false);

        const state = useUIStore.getState();
        expect(state.loadingStates.sessions).toBe(false);
      });

      it('should not affect other loading states', () => {
        useUIStore.getState().setLoading('sessions', true);
        useUIStore.getState().setLoading('messages', true);

        useUIStore.getState().setLoading('sessions', false);

        const state = useUIStore.getState();
        expect(state.loadingStates.sessions).toBe(false);
        expect(state.loadingStates.messages).toBe(true);
      });
    });

    describe('isLoading', () => {
      it('should return true when key is loading', () => {
        useUIStore.setState({
          loadingStates: {
            ...useUIStore.getState().loadingStates,
            sessions: true,
          },
        });

        expect(useUIStore.getState().isLoading('sessions')).toBe(true);
      });

      it('should return false when key is not loading', () => {
        expect(useUIStore.getState().isLoading('sessions')).toBe(false);
      });

      it('should return correct value for each key', () => {
        useUIStore.setState({
          loadingStates: {
            sessions: true,
            messages: false,
            settings: true,
            models: false,
            tools: true,
            global: false,
          },
        });

        expect(useUIStore.getState().isLoading('sessions')).toBe(true);
        expect(useUIStore.getState().isLoading('messages')).toBe(false);
        expect(useUIStore.getState().isLoading('settings')).toBe(true);
        expect(useUIStore.getState().isLoading('models')).toBe(false);
        expect(useUIStore.getState().isLoading('tools')).toBe(true);
        expect(useUIStore.getState().isLoading('global')).toBe(false);
      });
    });

    describe('isAnyLoading', () => {
      it('should return false when no loading states are active', () => {
        expect(useUIStore.getState().isAnyLoading()).toBe(false);
      });

      it('should return true when one loading state is active', () => {
        useUIStore.getState().setLoading('sessions', true);

        expect(useUIStore.getState().isAnyLoading()).toBe(true);
      });

      it('should return true when multiple loading states are active', () => {
        useUIStore.getState().setLoading('sessions', true);
        useUIStore.getState().setLoading('messages', true);

        expect(useUIStore.getState().isAnyLoading()).toBe(true);
      });

      it('should return false after all loading states are cleared', () => {
        useUIStore.getState().setLoading('sessions', true);
        useUIStore.getState().setLoading('messages', true);

        useUIStore.getState().setLoading('sessions', false);
        useUIStore.getState().setLoading('messages', false);

        expect(useUIStore.getState().isAnyLoading()).toBe(false);
      });
    });
  });

  describe('Permission Dialog', () => {
    describe('showPermissionDialog', () => {
      it('should show permission dialog with request', () => {
        const request = createMockPermissionRequest();

        useUIStore.getState().showPermissionDialog(request);

        const state = useUIStore.getState();
        expect(state.permissionDialogVisible).toBe(true);
        expect(state.currentPermissionRequest).toEqual(request);
      });

      it('should replace existing permission request', () => {
        const request1 = createMockPermissionRequest({ id: 'perm-1' });
        const request2 = createMockPermissionRequest({ id: 'perm-2' });

        useUIStore.getState().showPermissionDialog(request1);
        useUIStore.getState().showPermissionDialog(request2);

        const state = useUIStore.getState();
        expect(state.currentPermissionRequest?.id).toBe('perm-2');
      });

      it('should store all permission request fields', () => {
        const request = createMockPermissionRequest({
          id: 'test-id',
          sessionId: 'test-session',
          toolName: 'test_tool',
          arguments: { key: 'value', nested: { a: 1 } },
          description: 'Test description',
        });

        useUIStore.getState().showPermissionDialog(request);

        const state = useUIStore.getState();
        expect(state.currentPermissionRequest?.id).toBe('test-id');
        expect(state.currentPermissionRequest?.sessionId).toBe('test-session');
        expect(state.currentPermissionRequest?.toolName).toBe('test_tool');
        expect(state.currentPermissionRequest?.arguments).toEqual({
          key: 'value',
          nested: { a: 1 },
        });
        expect(state.currentPermissionRequest?.description).toBe('Test description');
      });
    });

    describe('hidePermissionDialog', () => {
      it('should hide permission dialog', () => {
        const request = createMockPermissionRequest();
        useUIStore.setState({
          currentPermissionRequest: request,
          permissionDialogVisible: true,
        });

        useUIStore.getState().hidePermissionDialog();

        const state = useUIStore.getState();
        expect(state.permissionDialogVisible).toBe(false);
        expect(state.currentPermissionRequest).toBeNull();
      });

      it('should handle hiding when already hidden', () => {
        useUIStore.getState().hidePermissionDialog();

        const state = useUIStore.getState();
        expect(state.permissionDialogVisible).toBe(false);
        expect(state.currentPermissionRequest).toBeNull();
      });
    });
  });

  describe('Settings Panel', () => {
    describe('openSettingsPanel', () => {
      it('should open settings panel', () => {
        useUIStore.getState().openSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(true);
      });

      it('should handle opening when already open', () => {
        useUIStore.setState({ settingsPanelOpen: true });

        useUIStore.getState().openSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(true);
      });
    });

    describe('closeSettingsPanel', () => {
      it('should close settings panel', () => {
        useUIStore.setState({ settingsPanelOpen: true });

        useUIStore.getState().closeSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(false);
      });

      it('should handle closing when already closed', () => {
        useUIStore.getState().closeSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(false);
      });
    });

    describe('toggleSettingsPanel', () => {
      it('should toggle settings panel from closed to open', () => {
        useUIStore.getState().toggleSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(true);
      });

      it('should toggle settings panel from open to closed', () => {
        useUIStore.setState({ settingsPanelOpen: true });

        useUIStore.getState().toggleSettingsPanel();

        const state = useUIStore.getState();
        expect(state.settingsPanelOpen).toBe(false);
      });

      it('should toggle settings panel multiple times correctly', () => {
        expect(useUIStore.getState().settingsPanelOpen).toBe(false);

        useUIStore.getState().toggleSettingsPanel();
        expect(useUIStore.getState().settingsPanelOpen).toBe(true);

        useUIStore.getState().toggleSettingsPanel();
        expect(useUIStore.getState().settingsPanelOpen).toBe(false);
      });
    });
  });

  describe('Notifications', () => {
    describe('showNotification', () => {
      it('should show info notification', () => {
        useUIStore.getState().showNotification({
          type: 'info',
          message: 'Test info message',
        });

        const state = useUIStore.getState();
        expect(state.notification).not.toBeNull();
        expect(state.notification?.type).toBe('info');
        expect(state.notification?.message).toBe('Test info message');
        expect(state.notification?.id).toBeDefined();
      });

      it('should show success notification', () => {
        useUIStore.getState().showNotification({
          type: 'success',
          message: 'Operation successful',
        });

        const state = useUIStore.getState();
        expect(state.notification?.type).toBe('success');
        expect(state.notification?.message).toBe('Operation successful');
      });

      it('should show warning notification', () => {
        useUIStore.getState().showNotification({
          type: 'warning',
          message: 'Warning message',
        });

        const state = useUIStore.getState();
        expect(state.notification?.type).toBe('warning');
        expect(state.notification?.message).toBe('Warning message');
      });

      it('should show error notification', () => {
        useUIStore.getState().showNotification({
          type: 'error',
          message: 'Error occurred',
        });

        const state = useUIStore.getState();
        expect(state.notification?.type).toBe('error');
        expect(state.notification?.message).toBe('Error occurred');
      });

      it('should include duration when provided', () => {
        useUIStore.getState().showNotification({
          type: 'info',
          message: 'Auto-dismiss message',
          duration: 3000,
        });

        const state = useUIStore.getState();
        expect(state.notification?.duration).toBe(3000);
      });

      it('should generate unique notification IDs', () => {
        useUIStore.getState().showNotification({
          type: 'info',
          message: 'First notification',
        });
        const firstId = useUIStore.getState().notification?.id;

        useUIStore.getState().showNotification({
          type: 'info',
          message: 'Second notification',
        });
        const secondId = useUIStore.getState().notification?.id;

        expect(firstId).not.toBe(secondId);
      });

      it('should replace existing notification', () => {
        useUIStore.getState().showNotification({
          type: 'info',
          message: 'First message',
        });

        useUIStore.getState().showNotification({
          type: 'error',
          message: 'Second message',
        });

        const state = useUIStore.getState();
        expect(state.notification?.message).toBe('Second message');
        expect(state.notification?.type).toBe('error');
      });
    });

    describe('hideNotification', () => {
      it('should hide notification', () => {
        useUIStore.getState().showNotification({
          type: 'info',
          message: 'Test message',
        });

        useUIStore.getState().hideNotification();

        const state = useUIStore.getState();
        expect(state.notification).toBeNull();
      });

      it('should handle hiding when no notification exists', () => {
        useUIStore.getState().hideNotification();

        const state = useUIStore.getState();
        expect(state.notification).toBeNull();
      });
    });
  });

  describe('resetUIState', () => {
    it('should reset all UI state to defaults', () => {
      // Set various states
      useUIStore.setState({
        sidebarCollapsed: true,
        loadingStates: {
          sessions: true,
          messages: true,
          settings: true,
          models: true,
          tools: true,
          global: true,
        },
        currentPermissionRequest: createMockPermissionRequest(),
        permissionDialogVisible: true,
        settingsPanelOpen: true,
        notification: {
          id: 'test-id',
          type: 'error',
          message: 'Test error',
        },
      });

      useUIStore.getState().resetUIState();

      const state = useUIStore.getState();
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.loadingStates.sessions).toBe(false);
      expect(state.loadingStates.messages).toBe(false);
      expect(state.loadingStates.settings).toBe(false);
      expect(state.loadingStates.models).toBe(false);
      expect(state.loadingStates.tools).toBe(false);
      expect(state.loadingStates.global).toBe(false);
      expect(state.currentPermissionRequest).toBeNull();
      expect(state.permissionDialogVisible).toBe(false);
      expect(state.settingsPanelOpen).toBe(false);
      expect(state.notification).toBeNull();
    });

    it('should handle reset when already in default state', () => {
      useUIStore.getState().resetUIState();

      const state = useUIStore.getState();
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.permissionDialogVisible).toBe(false);
      expect(state.settingsPanelOpen).toBe(false);
    });
  });

  describe('State Independence', () => {
    it('should not affect sidebar when changing loading states', () => {
      useUIStore.setState({ sidebarCollapsed: true });

      useUIStore.getState().setLoading('sessions', true);

      const state = useUIStore.getState();
      expect(state.sidebarCollapsed).toBe(true);
      expect(state.loadingStates.sessions).toBe(true);
    });

    it('should not affect permission dialog when changing settings panel', () => {
      const request = createMockPermissionRequest();
      useUIStore.getState().showPermissionDialog(request);

      useUIStore.getState().openSettingsPanel();

      const state = useUIStore.getState();
      expect(state.permissionDialogVisible).toBe(true);
      expect(state.settingsPanelOpen).toBe(true);
    });

    it('should not affect notification when changing sidebar', () => {
      useUIStore.getState().showNotification({
        type: 'info',
        message: 'Test',
      });

      useUIStore.getState().toggleSidebar();

      const state = useUIStore.getState();
      expect(state.notification).not.toBeNull();
      expect(state.sidebarCollapsed).toBe(true);
    });
  });
});
