import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReporter';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/** Top-level React error boundary.
 *
 * Catches unhandled render errors and lifecycle exceptions, reports them to
 * /api/client-error, and renders a minimal fallback so the app doesn't show a
 * blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const err = error instanceof Error ? error : new Error(String(error));
    reportError({
      route: location.pathname,
      message: err.message,
      stack: err.stack,
      context: info.componentStack
        ? `componentStack:${info.componentStack.slice(0, 500)}`
        : undefined,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 p-8 text-zinc-100">
        <p className="text-lg font-semibold">Something went wrong</p>
        <p className="max-w-md text-center text-sm text-zinc-400">{this.state.message}</p>
        <button
          className="mt-2 rounded bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
          onClick={() => location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
