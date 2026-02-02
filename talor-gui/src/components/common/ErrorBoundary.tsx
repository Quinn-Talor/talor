/**
 * ErrorBoundary Component
 * 错误边界组件
 *
 * A React error boundary component that catches JavaScript errors in child components,
 * displays a user-friendly error page, and provides recovery options.
 *
 * @requirements 1.4 - 显示错误信息并提供手动重连选项
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { withTranslation, type WithTranslation } from 'react-i18next';

/**
 * Error icon component
 * 错误图标组件
 */
const ErrorIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
    />
  </svg>
);

/**
 * Refresh icon component
 * 刷新图标组件
 */
const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

/**
 * Home icon component
 * 首页图标组件
 */
const HomeIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
    />
  </svg>
);

/**
 * Chevron icon component for expand/collapse
 * 展开/收起的箭头图标组件
 */
const ChevronIcon: React.FC<{ className?: string; expanded?: boolean }> = ({ className, expanded }) => (
  <svg
    className={`${className} transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
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
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

/**
 * ErrorBoundary props interface
 * 错误边界属性接口
 */
export interface ErrorBoundaryProps extends WithTranslation {
  /** Child components to wrap / 要包裹的子组件 */
  children: ReactNode;
  /** Custom fallback component / 自定义回退组件 */
  fallback?: ReactNode | ((error: Error, resetError: () => void) => ReactNode);
  /** Callback when error is caught / 捕获错误时的回调 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Whether to show error details / 是否显示错误详情 */
  showDetails?: boolean;
  /** Custom class name for the error page / 错误页面的自定义类名 */
  className?: string;
}

/**
 * ErrorBoundary state interface
 * 错误边界状态接口
 */
export interface ErrorBoundaryState {
  /** Whether an error has been caught / 是否捕获到错误 */
  hasError: boolean;
  /** The caught error / 捕获的错误 */
  error: Error | null;
  /** Error info from React / React 的错误信息 */
  errorInfo: ErrorInfo | null;
  /** Whether to show error details / 是否显示错误详情 */
  showErrorDetails: boolean;
}

/**
 * ErrorBoundary component class
 * 错误边界组件类
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 *
 * @requirements 1.4 - 显示错误信息并提供手动重连选项
 */
class ErrorBoundaryClass extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showErrorDetails: false,
    };
  }

  /**
   * Static method to derive state from error
   * 从错误派生状态的静态方法
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Lifecycle method called when an error is caught
   * 捕获错误时调用的生命周期方法
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log the error
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Update state with error info
    this.setState({ errorInfo });

    // Call the onError callback if provided
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Reset the error state to retry rendering
   * 重置错误状态以重试渲染
   */
  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showErrorDetails: false,
    });
  };

  /**
   * Reload the page
   * 重新加载页面
   */
  handleReload = (): void => {
    window.location.reload();
  };

  /**
   * Navigate to home page
   * 导航到首页
   */
  handleGoHome = (): void => {
    window.location.href = '/';
  };

  /**
   * Toggle error details visibility
   * 切换错误详情可见性
   */
  handleToggleDetails = (): void => {
    this.setState((prevState) => ({
      showErrorDetails: !prevState.showErrorDetails,
    }));
  };

  /**
   * Render the error page
   * 渲染错误页面
   */
  renderErrorPage(): ReactNode {
    const { t, showDetails = true, className = '' } = this.props;
    const { error, errorInfo, showErrorDetails } = this.state;

    return (
      <div
        className={`
          min-h-screen flex items-center justify-center
          bg-gray-50 dark:bg-gray-900
          p-4
          ${className}
        `}
        role="alert"
        aria-live="assertive"
      >
        <div className="max-w-lg w-full text-center">
          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-full">
              <ErrorIcon className="w-12 h-12 text-red-600 dark:text-red-400" />
            </div>
          </div>

          {/* Error Title */}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {t('error.boundary.title')}
          </h1>

          {/* Error Description */}
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('error.boundary.description')}
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
            {/* Retry Button */}
            <button
              type="button"
              onClick={this.handleRetry}
              className="
                inline-flex items-center justify-center
                px-4 py-2
                bg-blue-600 hover:bg-blue-700
                text-white font-medium
                rounded-lg
                transition-colors duration-200
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                dark:focus:ring-offset-gray-900
              "
            >
              <RefreshIcon className="w-5 h-5 mr-2" />
              {t('error.boundary.retry')}
            </button>

            {/* Reload Button */}
            <button
              type="button"
              onClick={this.handleReload}
              className="
                inline-flex items-center justify-center
                px-4 py-2
                bg-gray-200 hover:bg-gray-300
                dark:bg-gray-700 dark:hover:bg-gray-600
                text-gray-700 dark:text-gray-200 font-medium
                rounded-lg
                transition-colors duration-200
                focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
                dark:focus:ring-offset-gray-900
              "
            >
              {t('error.boundary.reload')}
            </button>

            {/* Go Home Button */}
            <button
              type="button"
              onClick={this.handleGoHome}
              className="
                inline-flex items-center justify-center
                px-4 py-2
                bg-gray-200 hover:bg-gray-300
                dark:bg-gray-700 dark:hover:bg-gray-600
                text-gray-700 dark:text-gray-200 font-medium
                rounded-lg
                transition-colors duration-200
                focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
                dark:focus:ring-offset-gray-900
              "
            >
              <HomeIcon className="w-5 h-5 mr-2" />
              {t('error.boundary.goHome')}
            </button>
          </div>

          {/* Error Details Toggle */}
          {showDetails && error && (
            <div className="text-left">
              <button
                type="button"
                onClick={this.handleToggleDetails}
                className="
                  w-full flex items-center justify-between
                  px-4 py-2
                  bg-gray-100 dark:bg-gray-800
                  text-gray-700 dark:text-gray-300
                  rounded-lg
                  hover:bg-gray-200 dark:hover:bg-gray-700
                  transition-colors duration-200
                  focus:outline-none focus:ring-2 focus:ring-gray-500
                "
                aria-expanded={showErrorDetails}
              >
                <span className="font-medium">
                  {showErrorDetails
                    ? t('error.boundary.hideDetails')
                    : t('error.boundary.showDetails')}
                </span>
                <ChevronIcon className="w-5 h-5" expanded={showErrorDetails} />
              </button>

              {/* Error Details Content */}
              {showErrorDetails && (
                <div
                  className="
                    mt-3 p-4
                    bg-gray-100 dark:bg-gray-800
                    rounded-lg
                    text-left
                    overflow-auto
                    max-h-64
                  "
                >
                  {/* Error Message */}
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      {t('error.boundary.errorMessage')}
                    </h3>
                    <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-words font-mono">
                      {error.message}
                    </pre>
                  </div>

                  {/* Component Stack */}
                  {errorInfo?.componentStack && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                        {t('error.boundary.componentStack')}
                      </h3>
                      <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words font-mono">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // If a custom fallback is provided, use it
      if (fallback) {
        if (typeof fallback === 'function') {
          // If error is null (shouldn't happen but TypeScript needs this check),
          // render the default error page
          if (!error) {
            return this.renderErrorPage();
          }
          return fallback(error, this.handleRetry);
        }
        return fallback;
      }

      // Otherwise, render the default error page
      return this.renderErrorPage();
    }

    return children;
  }
}

/**
 * ErrorBoundary component with i18n support
 * 带有国际化支持的错误边界组件
 */
export const ErrorBoundary = withTranslation()(ErrorBoundaryClass);

/**
 * Props interface for the exported component (without WithTranslation)
 * 导出组件的属性接口（不包含 WithTranslation）
 */
export type ErrorBoundaryExportedProps = Omit<ErrorBoundaryProps, keyof WithTranslation>;

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default ErrorBoundary;
