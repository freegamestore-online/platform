import type { AgentMessage } from '../hooks/useAgent';
import { type ActivityTone, deriveActivity } from '../lib/activity';
import type { DeployState } from '../types';

const TONE: Record<ActivityTone, { dot: string; bg: string }> = {
  idle: { dot: 'var(--muted, #6b7280)', bg: 'var(--panel, #f9fafb)' },
  busy: { dot: 'var(--accent, #10b981)', bg: 'rgba(16,185,129,0.10)' },
  ok: { dot: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  error: { dot: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
};

/**
 * Always-visible status strip below the toolbar: says at a glance whether the
 * studio is coding, building, or deploying (or idle/live/failed). A spinner
 * shows while work is in progress; a colored dot encodes the tone.
 */
export function StatusBar({
  isStreaming,
  deployState,
  messages,
}: {
  isStreaming: boolean;
  deployState: DeployState | null;
  messages: AgentMessage[];
}) {
  const a = deriveActivity(isStreaming, deployState, messages);
  const tone = TONE[a.tone];

  return (
    <div
      className="shrink-0 flex items-center gap-2.5 px-3 py-2 text-sm border-b"
      style={{
        background: tone.bg,
        borderColor: 'var(--border, #e5e7eb)',
        color: 'var(--ink, #1a1a1a)',
      }}
      role="status"
      aria-live="polite"
    >
      {a.busy ? (
        <span
          aria-hidden
          className="shrink-0 rounded-full motion-safe:animate-spin"
          style={{
            width: 12,
            height: 12,
            border: `2px solid ${tone.dot}`,
            borderTopColor: 'transparent',
          }}
        />
      ) : (
        <span
          aria-hidden
          className="shrink-0 rounded-full"
          style={{ width: 10, height: 10, background: tone.dot }}
        />
      )}
      <span className="font-semibold shrink-0">{a.label}</span>
      {a.detail && (
        <span className="truncate" style={{ color: 'var(--muted, #6b7280)' }} title={a.detail}>
          {a.detail}
        </span>
      )}
    </div>
  );
}
