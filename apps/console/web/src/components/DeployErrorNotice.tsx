import { deployErrorInfo } from '../lib/deployError';
import type { DeployState } from '../types';

/**
 * The creator-facing "your deploy failed, here's why and what to do" surface.
 *
 * Lives in the CHAT column, not the preview pane. The pre-formatted error box in
 * DeployLog is inside `hidden md:flex`, so before this existed a creator on a
 * phone saw only a one-line banner, and the StatusBar's copy of the error was a
 * `title` tooltip — unreachable on touch. This renders on every viewport.
 */
export function DeployErrorNotice({
  state,
  appId,
  canRetry,
  onRetry,
}: {
  state: DeployState;
  appId?: string | null;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { message, actionsUrl } = deployErrorInfo(state, appId);

  return (
    <div
      role="alert"
      className="shrink-0 px-3 py-2.5"
      style={{
        background: 'rgba(239,68,68,0.12)',
        borderBottom: '1px solid var(--error, #ef4444)',
        color: 'var(--error, #ef4444)',
      }}
    >
      <div className="text-sm font-semibold">Deploy failed</div>
      {/* Capped + scrollable: a CI log tail can be hundreds of lines, and an
          unbounded box would push the composer off a phone screen. */}
      <pre
        className="text-xs whitespace-pre-wrap mt-1"
        style={{
          color: 'var(--ink, #1a1a1a)',
          maxHeight: 160,
          overflowY: 'auto',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          margin: 0,
        }}
      >
        {message}
      </pre>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {canRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center rounded-md px-3 h-9 text-sm font-semibold"
            style={{
              background: 'var(--error, #ef4444)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Fix &amp; retry
          </button>
        )}
        {actionsUrl && (
          <a
            href={actionsUrl}
            target="_blank"
            rel="noopener"
            className="text-xs underline"
            style={{ color: 'var(--error, #ef4444)' }}
          >
            View build logs
          </a>
        )}
      </div>
    </div>
  );
}
