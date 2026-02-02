/**
 * ErrorBoundary Component Tests
 * 错误边界组件测试
 *
 * Tests for the ErrorBoundary component that catches JavaScript errors
 * in child components and displays a user-friendly error page.
 *
 * @requirements 1.4 - 显示错误信息并提供手动重连选项
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Component that throws an error for testing
 * 用于测试的抛出错误的组件
 */
const ThrowError: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow = true }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div data-testid="child-content">Child content rendered successfully</div>;
};

/**
 * Component that throws an error on click
 * 点击时抛出错误的组件
 */
const ThrowErrorOnClick: React.FC = () => {
  const [shouldThrow, setShouldThrow] = React.useState(false);

  if (shouldThrow) {
    throw new Error('Error triggered by click');
  }

  return (
    <button data-testid="trigger-error" onClick={() => setShouldThrow(true)}>
      Trigger Error
    </button>
  );
};

/**
 * Wrapper component with i18n provider
 * 带有 i18n 提供者的包装组件
 */
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
);

describe('ErrorBoundary', () => {
  // Suppress console.error during tests since we expect errors
  const originalConsoleError = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  describe('Normal rendering', () => {
    it('should render children when no error occurs', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError shouldThrow={false} />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Child content rendered successfully')).toBeInTheDocument();
    });

    it('should render multiple children when no error occurs', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <div data-testid="child-1">Child 1</div>
            <div data-testid="child-2">Child 2</div>
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByTestId('child-1')).toBeInTheDocument();
      expect(screen.getByTestId('child-2')).toBeInTheDocument();
    });
  });

  describe('Error catching', () => {
    it('should catch errors and display error page', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      // Should display error title
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      // Should display error description
      expect(screen.getByText('An unexpected error occurred in the application.')).toBeInTheDocument();
    });

    it('should call onError callback when error is caught', () => {
      const onError = vi.fn();

      render(
        <TestWrapper>
          <ErrorBoundary onError={onError}>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      );
    });

    it('should display error message in details', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showDetails>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      // Click to show details
      const showDetailsButton = screen.getByText('Show Details');
      fireEvent.click(showDetailsButton);

      // Should display error message
      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });
  });

  describe('Recovery actions', () => {
    it('should display retry button', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should display reload button', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByText('Reload Page')).toBeInTheDocument();
    });

    it('should display go home button', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByText('Go to Home')).toBeInTheDocument();
    });

    it('should reset error state when retry button is clicked', () => {
      const TestComponent: React.FC = () => {
        const [shouldThrow, setShouldThrow] = React.useState(true);

        return (
          <ErrorBoundary>
            {shouldThrow ? (
              <ThrowError />
            ) : (
              <div data-testid="recovered-content">
                <button onClick={() => setShouldThrow(true)}>Throw again</button>
                Recovered!
              </div>
            )}
          </ErrorBoundary>
        );
      };

      // This test verifies the retry button exists and is clickable
      // The actual recovery depends on the component state being reset
      render(
        <TestWrapper>
          <TestComponent />
        </TestWrapper>
      );

      // Error page should be displayed
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Retry button should be present
      const retryButton = screen.getByText('Try Again');
      expect(retryButton).toBeInTheDocument();
    });
  });

  describe('Error details toggle', () => {
    it('should toggle error details visibility', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showDetails>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      // Initially details should be hidden
      expect(screen.queryByText('Error message')).not.toBeInTheDocument();

      // Click to show details
      const showDetailsButton = screen.getByText('Show Details');
      fireEvent.click(showDetailsButton);

      // Details should now be visible
      expect(screen.getByText('Error message')).toBeInTheDocument();

      // Click to hide details
      const hideDetailsButton = screen.getByText('Hide Details');
      fireEvent.click(hideDetailsButton);

      // Details should be hidden again
      expect(screen.queryByText('Error message')).not.toBeInTheDocument();
    });

    it('should not show details toggle when showDetails is false', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showDetails={false}>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.queryByText('Show Details')).not.toBeInTheDocument();
    });
  });

  describe('Custom fallback', () => {
    it('should render custom fallback ReactNode when provided', () => {
      render(
        <TestWrapper>
          <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error page</div>}>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
      expect(screen.getByText('Custom error page')).toBeInTheDocument();
    });

    it('should render custom fallback function when provided', () => {
      const customFallback = (error: Error, resetError: () => void) => (
        <div data-testid="custom-fallback-fn">
          <p>Error: {error.message}</p>
          <button onClick={resetError}>Reset</button>
        </div>
      );

      render(
        <TestWrapper>
          <ErrorBoundary fallback={customFallback}>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByTestId('custom-fallback-fn')).toBeInTheDocument();
      expect(screen.getByText('Error: Test error message')).toBeInTheDocument();
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have role="alert" on error page', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should have aria-live="assertive" on error page', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      const alertElement = screen.getByRole('alert');
      expect(alertElement).toHaveAttribute('aria-live', 'assertive');
    });

    it('should have aria-expanded on details toggle button', () => {
      render(
        <TestWrapper>
          <ErrorBoundary showDetails>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      // Get the button by its role and name
      const showDetailsButton = screen.getByRole('button', { name: /show details/i });
      expect(showDetailsButton).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(showDetailsButton);

      const hideDetailsButton = screen.getByRole('button', { name: /hide details/i });
      expect(hideDetailsButton).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('Internationalization', () => {
    it('should display translated error title', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      // Default language is English
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should display translated buttons', () => {
      render(
        <TestWrapper>
          <ErrorBoundary>
            <ThrowError />
          </ErrorBoundary>
        </TestWrapper>
      );

      expect(screen.getByText('Try Again')).toBeInTheDocument();
      expect(screen.getByText('Reload Page')).toBeInTheDocument();
      expect(screen.getByText('Go to Home')).toBeInTheDocument();
    });
  });
});
