import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SessionErrorEntry, type SessionHistory, type TranscriptMessage } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

const PAGE = 30;

function fmtTs(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hm}`;
}

export function SessionView({ id, navigate }: { id: string; navigate: (h: string) => void }) {
  const [history, setHistory] = useState<SessionHistory | null>(null);
  const [errors, setErrors] = useState<SessionErrorEntry[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [win, setWin] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const [chatMsg, setChatMsg] = useState("");
  const [chatState, setChatState] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  const fetchHistory = useCallback(() => api<SessionHistory>(`/api/sessionhistory?id=${encodeURIComponent(id)}`), [id]);

  // initial load → jump to newest
  useEffect(() => {
    fetchHistory()
      .then((h) => { setHistory(h); countRef.current = h.messages.length; setTimeout(() => bottomRef.current?.scrollIntoView(), 50); })
      .catch((e) => setError(e.message));
  }, [fetchHistory]);

  // live poll: follow new messages when the reader is near the bottom
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const h = await fetchHistory();
        if (h.messages.length !== countRef.current) {
          countRef.current = h.messages.length;
          const el = scrollRef.current;
          const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
          setHistory(h);
          if (nearBottom) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        }
      } catch { /* transient poll failure — next tick retries */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [fetchHistory]);

  const send = useCallback(async () => {
    const message = chatMsg.trim();
    if (!message) return;
    setChatMsg("");
    setChatState("Sent — the agent is working; the transcript follows live.");
    try {
      const res = await fetch(`/api/sessionchat?id=${encodeURIComponent(id)}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) { setChatState(`Failed (${res.status})`); return; }
      const reader = res.body?.getReader();
      if (reader) for (;;) { const { done } = await reader.read(); if (done) break; }
      setChatState("Turn finished.");
    } catch (e) { setChatState(String(e)); }
  }, [chatMsg, id]);

  if (error) return <ErrorBox message={error} />;
  if (!history) return <Loading />;

  const msgs = history.messages;
  const start = Math.max(0, msgs.length - win);

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 8rem)" }}>
      <div className="flex items-center gap-3 mb-3">
        <button onClick={() => navigate("/sessions")} className="text-sm" style={{ color: "var(--muted)" }}>&larr; Sessions</button>
        <h1 className="text-lg font-bold flex-1" style={{ color: "var(--ink)" }}>{history.appName || history.appId || id.slice(0, 12)}</h1>
        <span className="text-xs" style={{ color: "#059669" }}>● live</span>
        <button
          onClick={async () => {
            if (!showErrors && errors === null) {
              try { setErrors((await api<{ errors: SessionErrorEntry[] }>(`/api/sessionerrors?id=${encodeURIComponent(id)}`)).errors ?? []); } catch { setErrors([]); }
            }
            setShowErrors((v) => !v);
          }}
          className="text-xs rounded-lg border px-2.5 py-1" style={{ borderColor: "#fca5a5", color: "#dc2626" }}
        >{showErrors ? "Transcript" : "Errors"}</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        {showErrors ? (
          (errors ?? []).length === 0 ? <p className="text-sm" style={{ color: "#059669" }}>No server-side errors for this session.</p> : (errors ?? []).map((e, i) => (
            <div key={i} className="rounded-lg border p-3 mb-2" style={{ borderColor: "#fca5a5", background: "#fef2f2" }}>
              <div className="text-xs mb-1" style={{ color: "var(--muted)" }}><span className="font-semibold">{e.source}</span> · {e.timestamp}</div>
              <pre className="text-xs whitespace-pre-wrap" style={{ color: "#b91c1c" }}>{e.message}</pre>
            </div>
          ))
        ) : (
          <>
            {start > 0 && (
              <button onClick={() => setWin((w) => w + PAGE)} className="block mx-auto mb-3 text-xs rounded-full border px-3 py-1" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
                ↑ Load earlier ({start} older)
              </button>
            )}
            {msgs.slice(start).map((m, i) => <Bubble key={start + i} m={m} />)}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          value={chatMsg}
          onChange={(e) => setChatMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Send a prompt into this session (runs as the user, with their key)…"
          className="flex-1 rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}
        />
        <button onClick={send} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>Send</button>
      </div>
      {chatState && <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>{chatState}</p>}
    </div>
  );
}

function Bubble({ m }: { m: TranscriptMessage }) {
  const ts = m.ts ? <span className="float-right text-[10px] ml-2" style={{ color: "var(--muted)" }} title={m.ts ? new Date(m.ts).toISOString() : ""}>{fmtTs(m.ts)}</span> : null;
  if (m.role === "user") {
    return (
      <div className="rounded-xl px-3 py-2 mb-2" style={{ background: "var(--accent-soft)" }}>
        {ts}<span className="text-xs font-bold" style={{ color: "var(--accent-deep)" }}>User</span>
        <div className="text-sm whitespace-pre-wrap mt-0.5" style={{ color: "var(--ink)" }}>{(m.content || "").slice(0, 4000)}</div>
      </div>
    );
  }
  if (m.role === "assistant") {
    const tools = (m.toolCalls ?? []).map((tc, i) => {
      const arg = tc.input?.path || tc.input?.id || tc.input?.name || "";
      return <span key={i} className="inline-block text-[11px] rounded border px-1.5 py-0.5 mr-1 mt-1" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>{tc.name}{arg ? ` ${arg}` : ""}</span>;
    });
    return (
      <div className="rounded-xl px-3 py-2 mb-2 border" style={{ borderColor: "var(--line)" }}>
        {ts}<span className="text-xs font-bold" style={{ color: "#059669" }}>AI</span>
        <div className="text-sm whitespace-pre-wrap mt-0.5" style={{ color: "var(--ink)" }}>{(m.content || "").slice(0, 4000) || <span style={{ color: "var(--muted)" }}>(tool call)</span>}</div>
        {tools.length > 0 && <div>{tools}</div>}
      </div>
    );
  }
  if (m.role === "tool_result") {
    const rs = (m.toolResults ?? []).map((tr) => tr.content?.trim()).filter(Boolean) as string[];
    if (rs.length === 0) return null;
    return (
      <details className="ml-4 mb-2">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>{ts}tool result{rs.length > 1 ? `s (${rs.length})` : ""}</summary>
        <pre className="text-[11px] whitespace-pre-wrap mt-1 rounded-lg border p-2 max-h-56 overflow-auto" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>{rs.join("\n───\n")}</pre>
      </details>
    );
  }
  return <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{m.role}: {(m.content || "").slice(0, 300)}</div>;
}
