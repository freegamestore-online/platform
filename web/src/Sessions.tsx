import { useEffect, useState } from "react";
import { api, timeAgo, type SessionRow } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

export function Sessions({ navigate }: { navigate: (h: string) => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ sessions: SessionRow[] }>("/api/sessions").then((d) => setRows(d.sessions)).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!rows) return <Loading />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--ink)" }}>VibeCode sessions <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>({rows.length})</span></h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>Every user's studio chats, newest first. Click a row for the live transcript — and to chat into the session on their behalf.</p>
      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">User</th><th className="px-4 py-2.5">Session</th><th className="px-4 py-2.5">Game</th><th className="px-4 py-2.5">State</th><th className="px-4 py-2.5">Tokens</th><th className="px-4 py-2.5">Updated</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)} className="border-t cursor-pointer hover:opacity-80" style={{ borderColor: "var(--line)" }}>
                <td className="px-4 py-2.5 font-medium" style={{ color: "var(--ink)" }}>{s.user}</td>
                <td className="px-4 py-2.5"><span style={{ color: "var(--ink)" }}>{s.name}</span><br /><span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.id}</span></td>
                <td className="px-4 py-2.5">{s.gameId ? <a href={s.gameUrl || `https://${s.gameId}.freegamestore.online`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} style={{ color: "var(--accent)" }}>{s.gameId}</a> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                <td className="px-4 py-2.5">{s.deployed ? <span style={{ color: "#059669" }}>deployed</span> : <span style={{ color: "#d97706" }}>draft</span>}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{s.tokens.input + s.tokens.output > 0 ? `${Math.round((s.tokens.input + s.tokens.output) / 1000)}k` : "—"}</td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>{timeAgo(s.updatedAt || s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
