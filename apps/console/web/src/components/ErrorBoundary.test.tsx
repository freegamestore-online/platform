import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Mock the error reporter so we can assert it was called without hitting fetch.
vi.mock('../lib/errorReporter', () => ({
  reportError: vi.fn(),
}));

import { reportError } from '../lib/errorReporter';

const mReportError = vi.mocked(reportError);

// A component that throws unconditionally — used to trigger the boundary.
function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message);
}

// Suppress React's console.error for caught boundary errors in test output.
let originalConsoleError: typeof console.error;
beforeEach(() => {
  originalConsoleError = console.error;
  console.error = () => {};
  vi.clearAllMocks();
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe('ErrorBoundary', () => {
  it('renders children normally when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div>Hello world</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders the fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Render failed" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Render failed')).toBeDefined();
    expect(screen.getByRole('button', { name: /reload/i })).toBeDefined();
  });

  it('calls reportError with the error message and stack when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Test crash" />
      </ErrorBoundary>,
    );

    expect(mReportError).toHaveBeenCalledOnce();
    const report = mReportError.mock.calls[0]?.[0];
    expect(report?.message).toBe('Test crash');
    expect(report?.stack).toContain('ThrowingChild');
  });

  it('includes the componentStack in the context field', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="stack test" />
      </ErrorBoundary>,
    );

    const report = mReportError.mock.calls[0]?.[0];
    expect(report?.context).toMatch(/componentStack:/);
  });
});
