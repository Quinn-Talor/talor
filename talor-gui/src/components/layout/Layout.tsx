/**
 * Layout Component
 * 布局组件
 *
 * Main layout component that provides the application structure with:
 * - Collapsible sidebar for session list
 * - Main content area for chat
 * - Responsive design using Tailwind CSS breakpoints
 * - Light/dark theme support
 *
 * @requirements 9.1 - 在桌面浏览器中提供侧边栏和主内容区的双栏布局
 * @requirements 9.2 - 屏幕宽度小于断点时切换为单栏布局并隐藏侧边栏
 * @requirements 9.3 - 支持侧边栏的展开和折叠
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../store/ui';
import { useSettingsStore, getEffectiveTheme } from '../../store/settings';

/**
 * Layout props interface
 * 布局属性接口
 */
export interface LayoutProps {
  /** Main content to render / 要渲染的主内容 */
  children: React.ReactNode;
  /** Sidebar content to render / 要渲染的侧边栏内容 */
  sidebar?: React.ReactNode;
  /** Header content to render / 要渲染的头部内容 */
  header?: React.ReactNode;
  /** Footer content to render / 要渲染的底部内容 */
  footer?: React.ReactNode;
  /** Custom class name for the layout container / 布局容器的自定义类名 */
  className?: string;
}

/**
 * Responsive breakpoint for mobile/tablet detection
 * 移动端/平板检测的响应式断点
 *
 * @requirements 9.2 - 屏幕宽度小于断点时切换为单栏布局
 */
const MOBILE_BREAKPOINT = 768; // md breakpoint

/**
 * Sidebar width constants
 * 侧边栏宽度常量
 */
const SIDEBAR_WIDTH = 280; // px
const SIDEBAR_COLLAPSED_WIDTH = 0; // px when collapsed

/**
 * Menu icon component for sidebar toggle
 * 侧边栏切换的菜单图标组件
 */
const MenuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 6h16M4 12h16M4 18h16"
    />
  </svg>
);

/**
 * Close icon component for sidebar toggle
 * 侧边栏切换的关闭图标组件
 */
const CloseIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);

/**
 * Chevron left icon for collapse button
 * 折叠按钮的左箭头图标
 */
const ChevronLeftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 19l-7-7 7-7"
    />
  </svg>
);

/**
 * Chevron right icon for expand button
 * 展开按钮的右箭头图标
 */
const ChevronRightIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 5l7 7-7 7"
    />
  </svg>
);

/**
 * Layout component
 * 布局组件
 *
 * Provides the main application layout with responsive sidebar and theme support.
 *
 * @param props - Layout props / 布局属性
 * @returns Layout component / 布局组件
 *
 * @requirements 9.1 - 在桌面浏览器中提供侧边栏和主内容区的双栏布局
 * @requirements 9.2 - 屏幕宽度小于断点时切换为单栏布局并隐藏侧边栏
 * @requirements 9.3 - 支持侧边栏的展开和折叠
 */
export const Layout: React.FC<LayoutProps> = ({
  children,
  sidebar,
  header,
  footer,
  className = '',
}) => {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, setSidebarCollapsed } = useUIStore();
  const { theme } = useSettingsStore();
  const effectiveTheme = getEffectiveTheme(theme);

  // Track if we're on mobile for responsive behavior
  const [isMobile, setIsMobile] = useState(false);
  // Track if mobile sidebar overlay is open
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /**
   * Handle window resize for responsive behavior
   * 处理窗口调整大小以实现响应式行为
   *
   * @requirements 9.2 - 屏幕宽度小于断点时切换为单栏布局
   */
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      
      // Auto-collapse sidebar on mobile
      if (mobile && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
      
      // Close mobile menu when switching to desktop
      if (!mobile && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };

    // Initial check
    handleResize();

    // Add resize listener
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarCollapsed, setSidebarCollapsed, mobileMenuOpen]);

  /**
   * Toggle mobile menu
   * 切换移动端菜单
   */
  const handleMobileMenuToggle = useCallback(() => {
    setMobileMenuOpen((prev) => !prev);
  }, []);

  /**
   * Close mobile menu
   * 关闭移动端菜单
   */
  const handleMobileMenuClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  /**
   * Handle sidebar toggle for desktop
   * 处理桌面端侧边栏切换
   *
   * @requirements 9.3 - 支持侧边栏的展开和折叠
   */
  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      handleMobileMenuToggle();
    } else {
      toggleSidebar();
    }
  }, [isMobile, handleMobileMenuToggle, toggleSidebar]);

  /**
   * Handle keyboard navigation for accessibility
   * 处理键盘导航以实现无障碍访问
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && mobileMenuOpen) {
        handleMobileMenuClose();
      }
    },
    [mobileMenuOpen, handleMobileMenuClose]
  );

  // Calculate sidebar width based on collapsed state
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div
      className={`
        flex flex-col min-h-screen
        bg-white dark:bg-gray-900
        text-gray-900 dark:text-gray-100
        transition-colors duration-200
        ${className}
      `}
      onKeyDown={handleKeyDown}
      data-theme={effectiveTheme}
    >
      {/* Header */}
      {header && (
        <header
          className="
            sticky top-0 z-30
            flex items-center
            h-14 px-4
            bg-white dark:bg-gray-800
            border-b border-gray-200 dark:border-gray-700
            shadow-sm
          "
          role="banner"
        >
          {/* Mobile menu button */}
          <button
            type="button"
            onClick={handleSidebarToggle}
            className="
              p-2 mr-2
              rounded-lg
              text-gray-500 dark:text-gray-400
              hover:bg-gray-100 dark:hover:bg-gray-700
              focus:outline-none focus:ring-2 focus:ring-blue-500
              transition-colors duration-200
              md:hidden
            "
            aria-label={t('nav.sidebar.toggle')}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <CloseIcon className="w-6 h-6" />
            ) : (
              <MenuIcon className="w-6 h-6" />
            )}
          </button>

          {/* Desktop sidebar toggle */}
          <button
            type="button"
            onClick={handleSidebarToggle}
            className="
              hidden md:flex
              p-2 mr-2
              rounded-lg
              text-gray-500 dark:text-gray-400
              hover:bg-gray-100 dark:hover:bg-gray-700
              focus:outline-none focus:ring-2 focus:ring-blue-500
              transition-colors duration-200
            "
            aria-label={sidebarCollapsed ? t('nav.sidebar.expand') : t('nav.sidebar.collapse')}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              <ChevronRightIcon className="w-5 h-5" />
            ) : (
              <ChevronLeftIcon className="w-5 h-5" />
            )}
          </button>

          {/* Header content */}
          <div className="flex-1">{header}</div>
        </header>
      )}

      {/* Main layout container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile sidebar overlay */}
        {isMobile && mobileMenuOpen && (
          <div
            className="
              fixed inset-0 z-40
              bg-black/50
              transition-opacity duration-300
            "
            onClick={handleMobileMenuClose}
            aria-hidden="true"
          />
        )}

        {/* Sidebar */}
        {sidebar && (
          <aside
            className={`
              ${isMobile ? 'fixed inset-y-0 left-0 z-50' : 'relative'}
              flex flex-col
              bg-gray-50 dark:bg-gray-800
              border-r border-gray-200 dark:border-gray-700
              transition-all duration-300 ease-in-out
              ${isMobile
                ? mobileMenuOpen
                  ? 'translate-x-0'
                  : '-translate-x-full'
                : ''
              }
            `}
            style={{
              width: isMobile ? SIDEBAR_WIDTH : sidebarWidth,
              minWidth: isMobile ? SIDEBAR_WIDTH : sidebarWidth,
            }}
            role="complementary"
            aria-label={t('a11y.sessionList')}
          >
            {/* Sidebar header with close button on mobile */}
            {isMobile && (
              <div className="flex items-center justify-between h-14 px-4 border-b border-gray-200 dark:border-gray-700">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {t('session.title')}
                </span>
                <button
                  type="button"
                  onClick={handleMobileMenuClose}
                  className="
                    p-2
                    rounded-lg
                    text-gray-500 dark:text-gray-400
                    hover:bg-gray-100 dark:hover:bg-gray-700
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                    transition-colors duration-200
                  "
                  aria-label={t('common.close')}
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Sidebar content */}
            <div className="flex-1 overflow-y-auto">
              {sidebar}
            </div>
          </aside>
        )}

        {/* Main content area */}
        <main
          className="
            flex-1 flex flex-col
            min-w-0
            overflow-hidden
            bg-white dark:bg-gray-900
          "
          role="main"
          aria-label={t('a11y.chatArea')}
        >
          {children}
        </main>
      </div>

      {/* Footer */}
      {footer && (
        <footer
          className="
            flex items-center
            h-10 px-4
            bg-gray-50 dark:bg-gray-800
            border-t border-gray-200 dark:border-gray-700
            text-sm text-gray-500 dark:text-gray-400
          "
          role="contentinfo"
        >
          {footer}
        </footer>
      )}
    </div>
  );
};

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default Layout;
