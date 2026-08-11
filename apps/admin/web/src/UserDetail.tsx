import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fetchAllSessions, timeAgo, type CompGrant, type Creator, type ErrorRow, type GameInfo, type QualityData, type RegisteredUser, type SessionRow } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";
import { ErrorCard } from "./Errors.tsx";

interface UserDetailData {
  users: RegisteredUser[];
  creators: Creator[];
  games: GameInfo[];
  sessions: SessionRow[];
  grants: CompGrant[];
  quality: Map<string, QualityData["games"][number]>;
}

export function UserDetail({ id, navigate }: { id: string; navigate: (h: string) => void }) {
  const decoded = decodeURIComponent(id);
  const [data, setData] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([
      api<{ users: RegisteredUser[] }>("/api/allusers"),
      api<Creator[]>("/api/users"),
      api<GameInfo[]>("/api/status"),
      fetchAllSessions(),
      api<{ grants: CompGrant[] }>("/api/comp"),
      api<QualityData>("/api/quality").catch(() => ({ timestamp: "", games: [] })),
    ])
      .then(([allUsers, creators, games, sessions, comp, quality]) => {
        setData({
          users: allUsers.users ?? [],
          creators: creators ?? [],
          games: games ?? [],
          sessions,
          grants: comp.grants ?? [],
          quality: new Map((quality.games ?? []).map((g) => [g.id, g])),
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const detail = useMemo(() => {
    if (!data) return null;
    const needle = decoded.toLowerCase();
    const user = data.users.find((u) => u.id === decoded || u.name.toLowerCase() === needle) ?? null;
    const login = user?.name ?? decoded;
    const loginKey = login.toLowerCase();
    const creator = data.creators.find((c) => c.login.toLowerCase() === loginKey) ?? null;
    const gameIds = new Set(creator?.games ?? []);
    const sessions = data.sessions.filter((s) => {
      const byUserId = user && s.userId === user.id;
      const byLogin = s.user.toLowerCase() === loginKey;
      const byGame = s.gameId ? gameIds.has(s.gameId) : false;
      return byUserId || byLogin || byGame;
    });
    for (const s of sessions) if (s.gameId) gameIds.add(s.gameId);
    const games = data.games.filter((g) => gameIds.has(g.id));
    const grant = user ? data.grants.find((g) => g.userId === user.id) ?? user.grant : null;
    return { user, login, creator, games, sessions, grant };
  }, [data, decoded]);

  if (error) return <ErrorBox message={error} />;
  if (!data || !detail) return <Loading />;

  const latestSession = detail.sessions[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate("/users")} className="text-xs font-semibold mb-2" style={{ color: "var(--accent)" }}>Back to users</button>
          <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>{detail.login}</h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>{detail.user?.id ?? "Registry creator only"}</p>
        </div>
        {detail.user && (
          <button onClick={() => setKeyModal({ id: detail.user!.id, name: detail.user!.name })} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>
            Add key
          </button>
        )}
      </div>

      {msg && <p className="text-sm font-medium" style={{ color: "var(--accent-deep)" }}>{msg}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Games" value={detail.games.length} />
        <Stat label="Sessions" value={detail.sessions.length} />
        <Stat label="Keys" value={detail.user?.keys.length ?? 0} />
        <Stat label="Last activity" value={latestSession ? timeAgo(latestSession.updatedAt || latestSession.createdAt) : timeAgo(detail.user?.lastSeen ?? undefined)} />
      </div>

      <section className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <h2 className="text-sm font-bold mb-3" style={{ color: "var(--ink)" }}>Account</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <Detail label="Created" value={detail.user?.createdAt ? timeAgo(detail.user.createdAt) : "—"} />
          <Detail label="Last seen" value={detail.user?.lastSeen ? timeAgo(detail.user.lastSeen) : "—"} />
          <Detail label="Grant" value={detail.grant ? `${detail.grant.provider}/${detail.grant.model}` : "—"} />
          <div>
            <div className="text-xs uppercase mb-1" style={{ color: "var(--muted)" }}>Keys</div>
            {detail.user ? <Keys user={detail.user} reload={reload} /> : <span className="text-sm" style={{ color: "var(--muted)" }}>No registered account row.</span>}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--ink)" }}>Games</h2>
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">Game</th><th className="px-4 py-2.5">Quality</th><th className="px-4 py-2.5">Live</th><th className="px-4 py-2.5">Repo</th></tr></thead>
            <tbody>
              {detail.games.map((g) => {
                const q = data.quality.get(g.id);
                const qColor = !q ? "var(--muted)" : q.score >= 95 ? "#059669" : q.score >= 80 ? "#d97706" : "#dc2626";
                return (
                  <tr key={g.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-4 py-2.5"><span className="font-semibold" style={{ color: "var(--ink)" }}>{g.name}</span><br /><span className="text-[10px]" style={{ color: "var(--muted)" }}>{g.id}</span></td>
                    <td className="px-4 py-2.5 font-bold" style={{ color: qColor }}>{q ? q.score : "—"}</td>
                    <td className="px-4 py-2.5"><a href={`https://${g.domain}`} target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{g.domain}</a></td>
                    <td className="px-4 py-2.5"><a href={`https://github.com/${g.org}/${g.id}`} target="_blank" rel="noopener" className="text-xs" style={{ color: "var(--muted)" }}>{g.org}/{g.id}</a></td>
                  </tr>
                );
              })}
              {detail.games.length === 0 && <tr><td className="px-4 py-3" colSpan={4} style={{ color: "var(--muted)" }}>No registry games found for this user.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--ink)" }}>Sessions</h2>
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">Session</th><th className="px-4 py-2.5">Game</th><th className="px-4 py-2.5">State</th><th className="px-4 py-2.5">Tokens</th><th className="px-4 py-2.5">Updated</th></tr></thead>
            <tbody>
              {detail.sessions.map((s) => (
                <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)} className="border-t cursor-pointer hover:opacity-80" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-2.5"><span style={{ color: "var(--ink)" }}>{s.name}</span><br /><span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.id}</span></td>
                  <td className="px-4 py-2.5">{s.gameId ? <span style={{ color: "var(--accent)" }}>{s.gameId}</span> : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                  <td className="px-4 py-2.5">{s.deployed ? <span style={{ color: "#059669" }}>deployed</span> : <span style={{ color: "#d97706" }}>draft</span>}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{s.tokens.input + s.tokens.output > 0 ? `${Math.round((s.tokens.input + s.tokens.output) / 1000)}k` : "—"}</td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>{timeAgo(s.updatedAt || s.createdAt)}</td>
                </tr>
              ))}
              {detail.sessions.length === 0 && <tr><td className="px-4 py-3" colSpan={5} style={{ color: "var(--muted)" }}>No sessions found for this user.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <RecentErrors login={detail.login} />

      {keyModal && <AddKeyModal target={keyModal} onClose={() => setKeyModal(null)} onSaved={() => { setKeyModal(null); reload(); setMsg("Key saved."); }} />}
    </div>
  );
}

function RecentErrors({ login }: { login: string }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadErrors = useCallback(() => {
    setError(null);
    api<ErrorRow[]>(`/api/errors?user=${encodeURIComponent(login)}&limit=20`)
      .then(setRows)
      .catch((e) => setError((e as Error).message));
  }, [login]);

  const toggle = () => {
    if (!expanded && rows === null) loadErrors();
    setExpanded((v) => !v);
  };

  return (
    <section>
      <button
        onClick={toggle}
        className="flex items-center gap-2 text-lg font-bold mb-2"
        style={{ color: "var(--ink)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <span style={{ fontSize: "0.85em", color: "var(--muted)" }}>{expanded ? "▾" : "▸"}</span>
        Recent errors
      </button>
      {expanded && (
        <div className="flex flex-col gap-3">
          {error && <div className="text-sm" style={{ color: "#dc2626" }}>{error}</div>}
          {!error && rows === null && <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>}
          {rows !== null && rows.length === 0 && (
            <p className="text-sm" style={{ color: "var(--muted)" }}>No errors logged for this user.</p>
          )}
          {rows !== null && rows.map((e, i) => <ErrorCard key={i} e={e} />)}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <div className="text-xl font-bold" style={{ color: "var(--ink)" }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase mb-1" style={{ color: "var(--muted)" }}>{label}</div>
      <div style={{ color: "var(--ink)" }}>{value}</div>
    </div>
  );
}

function Keys({ user, reload }: { user: RegisteredUser; reload: () => void }) {
  if (user.keys.length === 0) return <span className="text-sm" style={{ color: "var(--muted)" }}>none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {user.keys.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border" style={{ borderColor: "var(--accent)", color: "var(--accent-deep)" }}>
          {k}
          <button title="Remove key" onClick={async () => { if (!confirm(`Remove ${k} key for ${user.name}?`)) return; await api("/api/userkey/delete", { method: "POST", body: JSON.stringify({ userId: user.id, provider: k }) }); reload(); }}>x</button>
        </span>
      ))}
    </div>
  );
}

function AddKeyModal({ target, onClose, onSaved }: { target: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const [provider, setProvider] = useState("anthropic");
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-2xl border p-5 w-full max-w-md" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <h3 className="font-bold mb-3" style={{ color: "var(--ink)" }}>Add API key for {target.name}</h3>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-sm mb-2" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}>
          {["anthropic", "openai", "google", "github"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-...  (stored encrypted, never shown again)" autoComplete="off" className="w-full rounded-lg border px-3 py-2 text-sm mb-2" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }} />
        {err && <p className="text-sm mb-2" style={{ color: "#dc2626" }}>{err}</p>}
        <div className="flex gap-2 mt-2">
          <button
            disabled={busy || !key}
            onClick={async () => {
              setBusy(true); setErr(null);
              try { await api("/api/userkey", { method: "POST", body: JSON.stringify({ userId: target.id, provider, key }) }); onSaved(); }
              catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
            }}
            className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}
          >Save key</button>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm border" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
