import type { AgentMessage } from '../hooks/useAgent';
import { type ActivityTone, deriveActivity } from '../lib/activity';
import type { DeployState } from '../types';

const TONE: Record<ActivityTone, { dot: string; ring: string; bg: string }> = {
  idle: { dot: 'bg-muted', ring: 'border-muted', bg: 'bg-panel' },
  busy: { dot: 'bg-accent', ring: 'border-accent', bg: 'bg-accent/10' },
  ok: { dot: 'bg-accent', ring: 'border-accent', bg: 'bg-accent/12' },
  error: { dot: 'bg-danger', ring: 'border-danger', bg: 'bg-danger/10' },
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
      className={`shrink-0 flex items-center gap-2.5 px-3 py-2 text-sm border-b border-line text-ink ${tone.bg}`}
      role="status"
      aria-live="polite"
    >
      {a.busy ? (
        <span
          aria-hidden
          className={`shrink-0 rounded-full motion-safe:animate-spin w-3 h-3 border-2 border-t-transparent ${tone.ring}`}
        />
      ) : (
        <span aria-hidden className={`shrink-0 rounded-full w-2.5 h-2.5 ${tone.dot}`} />
      )}
      <span className="font-semibold shrink-0">{a.label}</span>
      {a.detail && (
        <span className="truncate text-muted" title={a.detail}>
          {a.detail}
        </span>
      )}
    </div>
  );
}
