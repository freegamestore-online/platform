/** Chat message bubble — user, assistant, tool, or system.
 *
 *  When Kid mode is on (Profile → Kid mode), assistant replies are shown in a
 *  kid-friendly, funny rewrite; tapping the bubble flips to the original
 *  technical message. The rewrite is fetched lazily from the agent's free tier
 *  and cached; the original is always what's really in the transcript. */

import { useEffect, useRef, useState } from 'react';
import { fetchKidVersion, type KidMode } from '../lib/kidMode';
import { Markdown } from './Markdown';
import { cn } from './ui/cn';

// Complete class literals per role (Tailwind scans source text). Each role
// carries its own shape/size so a role override never fights a base utility.
const DEFAULT_CLASS = 'py-[0.55rem] px-3 rounded-xl text-[0.86rem]';
const ROLE_CLASS: Record<string, string> = {
  user: 'self-end bg-accent text-black py-[0.55rem] px-3 rounded-xl rounded-br-[0.15rem] text-[0.86rem]',
  assistant:
    'self-start bg-panel border border-line py-[0.55rem] px-3 rounded-xl rounded-bl-[0.15rem] text-[0.86rem]',
  tool: 'self-start text-[0.72rem] font-[monospace] bg-panel border border-line text-muted py-1 px-2 rounded-[0.35rem]',
  system: 'self-center text-[0.78rem] text-muted bg-transparent py-[0.55rem] px-3 rounded-xl',
};

function Hint({ label }: { label: string }) {
  return <div className="select-none mt-[5px] text-[0.68rem] opacity-65">{label}</div>;
}

export function ChatMessage({
  role,
  content,
  kid,
  live,
}: {
  role: string;
  content: string;
  kid?: KidMode;
  /** True while this is the still-streaming last assistant message — don't
   *  kidify a half-written reply; wait until the turn finishes. */
  live?: boolean;
}) {
  const useMarkdown = role === 'assistant';
  const kidEligible = role === 'assistant' && !!kid?.enabled && !live && content.trim().length > 12;

  const [kidText, setKidText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const reqRef = useRef(0);

  // Fetch (or recall) the kid rewrite whenever the message text or the chosen
  // age/vibe changes. reqRef guards against a stale response overwriting a newer
  // one (content can change as a streamed message settles).
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on kid.age/vibe, not the kid object — its identity can change every render, which would refetch the rewrite in a loop.
  useEffect(() => {
    if (!kidEligible || !kid) {
      setKidText(null);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    fetchKidVersion(content, kid)
      .then((k) => {
        if (id === reqRef.current) setKidText(k || null);
      })
      .catch(() => {
        if (id === reqRef.current) setKidText(null);
      })
      .finally(() => {
        if (id === reqRef.current) setLoading(false);
      });
  }, [kidEligible, content, kid?.age, kid?.vibe]);

  // A fresh message / mode change starts on the kid view again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content and kid.enabled are reset triggers, not values the effect reads.
  useEffect(() => {
    setShowOriginal(false);
  }, [content, kid?.enabled]);

  const canToggle = kidEligible && !!kidText;
  const showingKid = canToggle && !showOriginal;

  function onClick(e: React.MouseEvent) {
    if (!canToggle) return;
    // Don't hijack taps on links inside the rendered markdown.
    if ((e.target as HTMLElement).closest('a')) return;
    setShowOriginal((v) => !v);
  }

  return (
    <div
      onClick={canToggle ? onClick : undefined}
      role={canToggle ? 'button' : undefined}
      tabIndex={canToggle ? 0 : undefined}
      onKeyDown={
        canToggle
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setShowOriginal((v) => !v);
              }
            }
          : undefined
      }
      className={cn(
        'max-w-[88%] leading-normal [word-break:break-word]',
        ROLE_CLASS[role] ?? DEFAULT_CLASS,
        canToggle && 'cursor-pointer',
        !useMarkdown && 'whitespace-pre-wrap',
      )}
    >
      {showingKid ? (
        <>
          <div className="whitespace-pre-wrap">{kidText}</div>
          <Hint label="🧸 kid mode — tap for the grown-up version" />
        </>
      ) : useMarkdown ? (
        <>
          <Markdown text={content} />
          {canToggle && <Hint label="tap for the kid version" />}
          {kidEligible && !kidText && loading && <Hint label="✨ making a kid version…" />}
        </>
      ) : (
        content
      )}
    </div>
  );
}
