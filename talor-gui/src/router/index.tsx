/**
 * Router Configuration
 * 路由配置
 *
 * Configures React Router for the Talor GUI application.
 * Defines the route structure for navigation between pages.
 *
 * Routes:
 * - `/` - Home page (chat view)
 * - `/session/:sessionId` - Session view with specific session
 * - `/settings` - Settings page
 *
 * @requirements 2.2 - 用户选择一个现有会话时，加载该会话的消息历史
 */

import React, { Suspense } from 'react';
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
} from 'react-router-dom';
import { Layout } from '../components/layout/Layout';
import { HomePage, SettingsPage } from '../pages';

/**
 * Route paths constants
 * 路由路径常量
 */
export const ROUTES = {
  /** Home page / 首页 */
  HOME: '/',
  /** Session view with session ID / 带会话ID的会话视图 */
  SESSION: '/session/:sessionId',
  /** Settings page / 设置页面 */
  SETTINGS: '/settings',
} as const;

/**
 * Helper function to generate session route path
 * 生成会话路由路径的辅助函数
 *
 * @param sessionId - The session ID / 会话ID
 * @returns The session route path / 会话路由路径
 */
export function getSessionPath(sessionId: string): string {
  return `/session/${sessionId}`;
}

/**
 * Loading fallback component
 * 加载回退组件
 */
const LoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center h-full">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
  </div>
);

/**
 * Root layout component that wraps all routes
 * 包装所有路由的根布局组件
 */
const RootLayout: React.FC = () => (
  <Layout>
    <Suspense fallback={<LoadingFallback />}>
      <Outlet />
    </Suspense>
  </Layout>
);

/**
 * Not found page component
 * 404页面组件
 */
const NotFoundPage: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-4">
    <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
      404
    </h1>
    <p className="text-gray-600 dark:text-gray-300 mb-4">
      Page not found
    </p>
    <a
      href="/"
      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
    >
      Go Home
    </a>
  </div>
);

/**
 * Route configuration for the application
 * 应用程序的路由配置
 *
 * @requirements 2.2 - 用户选择一个现有会话时，加载该会话的消息历史
 */
export const routeConfig = [
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'session/:sessionId',
        element: <HomePage />,
      },
      {
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
];

/**
 * Create the browser router instance
 * 创建浏览器路由实例
 */
export const router = createBrowserRouter(routeConfig);

/**
 * Router component that provides routing to the application
 * 为应用程序提供路由的路由组件
 *
 * @returns Router provider component / 路由提供者组件
 */
export const AppRouter: React.FC = () => <RouterProvider router={router} />;

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default AppRouter;
