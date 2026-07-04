/** Chat message bubble — user, assistant, tool, or system.
 *
 *  When Kid mode is on (Profile → Kid mode), assistant replies are shown in a
 *  kid-friendly, funny rewrite; tapping the bubble flips to the original
 *  technical message. The rewrite is fetched lazily from the agent's free tier
 *  and cached; the original is always what's really in the transcript. */

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { fetchKidVersion, type KidMode } from "../lib/kidMode";

const STYLES: Record<string, React.CSSProperties> = {
  user: { alignSelf: "flex-end", background: "var(--accent)", color: "#000", borderBottomRightRadius: "0.15rem" },
  assistant: { alignSelf: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", borderBottomLeftRadius: "0.15rem" },
  tool: { alignSelf: "flex-start", fontSize: "0.72rem", fontFamily: "monospace", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)", padding: "0.25rem 0.5rem", borderRadius: "0.35rem" },
  system: { alignSelf: "center", fontSize: "0.78rem", color: "var(--muted)", background: "none" },
};

function Hint({ label }: { label: string }) {
  return (
    <div className="select-none" style={{ marginTop: 5, fontSize: "0.68rem", opacity: 0.65 }}>
      {label}
    </div>
  );
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
  const useMarkdown = role === "assistant";
  const kidEligible = role === "assistant" && !!kid?.enabled && !live && content.trim().length > 12;

  const [kidText, setKidText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const reqRef = useRef(0);

  // Fetch (or recall) the kid rewrite whenever the message text or the chosen
  // age/vibe changes. reqRef guards against a stale response overwriting a newer
  // one (content can change as a streamed message settles).
  useEffect(() => {
    if (!kidEligible || !kid) {
      setKidText(null);
      return;
    }
    const id = ++reqRef.current;
    setLoading(true);
    fetchKidVersion(content, kid)
      .then((k) => { if (id === reqRef.current) setKidText(k || null); })
      .catch(() => { if (id === reqRef.current) setKidText(null); })
      .finally(() => { if (id === reqRef.current) setLoading(false); });
  }, [kidEligible, content, kid?.age, kid?.vibe]);

  // A fresh message / mode change starts on the kid view again.
  useEffect(() => { setShowOriginal(false); }, [content, kid?.enabled]);

  const canToggle = kidEligible && !!kidText;
  const showingKid = canToggle && !showOriginal;

  function onClick(e: React.MouseEvent) {
    if (!canToggle) return;
    // Don't hijack taps on links inside the rendered markdown.
    if ((e.target as HTMLElement).closest("a")) return;
    setShowOriginal((v) => !v);
  }

  return (
    <div
      onClick={canToggle ? onClick : undefined}
      role={canToggle ? "button" : undefined}
      tabIndex={canToggle ? 0 : undefined}
      onKeyDown={canToggle ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowOriginal((v) => !v); } } : undefined}
      style={{
        maxWidth: "88%",
        padding: "0.55rem 0.75rem",
        borderRadius: "0.75rem",
        fontSize: "0.86rem",
        lineHeight: 1.5,
        wordBreak: "break-word",
        cursor: canToggle ? "pointer" : undefined,
        ...(!useMarkdown ? { whiteSpace: "pre-wrap" } : {}),
        ...STYLES[role],
      }}
    >
      {showingKid ? (
        <>
          <div style={{ whiteSpace: "pre-wrap" }}>{kidText}</div>
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
