import { useCallback, useEffect, useState } from "react";
import { api, type CompGrant, type Creator, type RegisteredUser } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

const PROVIDERS = ["anthropic", "openai", "google", "github"] as const;
const MODELS: Record<string, [string, string][]> = {
  anthropic: [["claude-sonnet-4-6", "Claude Sonnet 4.6"], ["claude-opus-4-8", "Claude Opus 4.8"], ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"]],
  openai: [["gpt-4o", "GPT-4o"], ["gpt-4o-mini", "GPT-4o Mini"]],
  google: [["gemini-2.5-pro", "Gemini 2.5 Pro"], ["gemini-2.5-flash", "Gemini 2.5 Flash"]],
  github: [["openai/gpt-4.1", "GPT-4.1"], ["openai/gpt-4o", "GPT-4o"]],
};

export function UsersPage() {
  const [users, setUsers] = useState<RegisteredUser[] | null>(null);
  const [creators, setCreators] = useState<Creator[] | null>(null);
  const [grants, setGrants] = useState<CompGrant[]>([]);
  const [funded, setFunded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    api<{ users: RegisteredUser[] }>("/api/allusers").then((d) => setUsers(d.users)).catch((e) => setError(e.message));
    api<Creator[]>("/api/users").then(setCreators).catch(() => {});
    api<{ grants: CompGrant[]; funded: string[] }>("/api/comp").then((d) => { setGrants(d.grants ?? []); setFunded(d.funded ?? []); }).catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (error) return <ErrorBox message={error} />;
  if (!users) return <Loading />;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-bold mb-1" style={{ color: "var(--ink)" }}>Registered users <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>({users.length})</span></h1>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Click <strong>Add key</strong> to paste a provider API key into a user's encrypted vault — their studio picks it up automatically.</p>
        {msg && <p className="text-sm mb-2 font-medium" style={{ color: "var(--accent-deep)" }}>{msg}</p>}
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">User</th><th className="px-4 py-2.5">ID</th><th className="px-4 py-2.5">Keys</th><th className="px-4 py-2.5">Grant</th><th className="px-4 py-2.5"></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: "var(--ink)" }}>{u.name}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{u.id}</td>
                  <td className="px-4 py-2.5">
                    {u.keys.length === 0 ? <span className="text-xs" style={{ color: "var(--muted)" }}>none</span> : u.keys.map((k) => (
                      <span key={k} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 mr-1 border" style={{ borderColor: "var(--accent)", color: "var(--accent-deep)" }}>
                        {k}
                        <button title="Remove key" onClick={async () => { if (!confirm(`Remove ${k} key for ${u.name}?`)) return; await api("/api/userkey/delete", { method: "POST", body: JSON.stringify({ userId: u.id, provider: k }) }); reload(); }}>×</button>
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{u.grant ? `${u.grant.provider}/${u.grant.model}` : "—"}</td>
                  <td className="px-4 py-2.5"><button onClick={() => setKeyModal({ id: u.id, name: u.name })} className="text-xs font-semibold rounded-lg px-2.5 py-1 text-white" style={{ background: "var(--accent)" }}>Add key</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <CompSection grants={grants} funded={funded} onChanged={() => { reload(); setMsg("Updated."); }} />

      <section>
        <h2 className="text-lg font-bold mb-2" style={{ color: "var(--ink)" }}>Creators</h2>
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">GitHub</th><th className="px-4 py-2.5">Games</th><th className="px-4 py-2.5">IDs</th></tr></thead>
            <tbody>
              {(creators ?? []).map((c) => (
                <tr key={c.login} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-2.5"><a href={`https://github.com/${c.login}`} target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{c.login}</a></td>
                  <td className="px-4 py-2.5 font-bold" style={{ color: "var(--ink)" }}>{c.games.length}</td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{c.games.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {keyModal && <AddKeyModal target={keyModal} onClose={() => setKeyModal(null)} onSaved={() => { setKeyModal(null); reload(); setMsg("Key saved — they can build now."); }} />}
    </div>
  );
}

function CompSection({ grants, funded, onChanged }: { grants: CompGrant[]; funded: string[]; onChanged: () => void }) {
  const [login, setLogin] = useState("");
  const [provider, setProvider] = useState(funded[0] ?? "anthropic");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (funded.length && !funded.includes(provider)) setProvider(funded[0]!); }, [funded, provider]);
  const models = MODELS[provider] ?? [];

  return (
    <section>
      <h2 className="text-lg font-bold mb-1" style={{ color: "var(--ink)" }}>Complimentary access</h2>
      <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>Platform-funded builds for select users (their own key always wins). {funded.length ? `Funded: ${funded.join(", ")}.` : "No platform keys funded yet."}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="github-login" className="rounded-lg border px-3 py-1.5 text-sm" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }} />
        <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(""); }} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}>
          {PROVIDERS.map((p) => <option key={p} value={p} disabled={!funded.includes(p)}>{p}{funded.includes(p) ? "" : " (no key)"}</option>)}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}>
          <option value="">model…</option>
          {models.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <button
          disabled={busy || !login || !model}
          onClick={async () => {
            setBusy(true); setErr(null);
            try { await api("/api/comp", { method: "POST", body: JSON.stringify({ login, provider, model }) }); setLogin(""); onChanged(); }
            catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >Grant</button>
      </div>
      {err && <p className="text-sm mb-2" style={{ color: "#dc2626" }}>{err}</p>}
      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}><th className="px-4 py-2.5">User</th><th className="px-4 py-2.5">Provider</th><th className="px-4 py-2.5">Model</th><th className="px-4 py-2.5">Expires</th><th className="px-4 py-2.5"></th></tr></thead>
          <tbody>
            {grants.length === 0 && <tr><td className="px-4 py-3" colSpan={5} style={{ color: "var(--muted)" }}>No grants.</td></tr>}
            {grants.map((g) => (
              <tr key={g.userId} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="px-4 py-2.5 text-xs" style={{ color: "var(--ink)" }}>{g.userId}</td>
                <td className="px-4 py-2.5">{g.provider}</td>
                <td className="px-4 py-2.5 text-xs">{g.model}</td>
                <td className="px-4 py-2.5 text-xs" style={{ color: "var(--muted)" }}>{g.expiresAt ?? "never"}</td>
                <td className="px-4 py-2.5"><button onClick={async () => { if (!confirm(`Revoke grant for ${g.userId}?`)) return; await api(`/api/comp/${encodeURIComponent(g.userId)}`, { method: "DELETE" }); onChanged(); }} className="text-xs" style={{ color: "#dc2626" }}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
          {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…  (stored encrypted, never shown again)" autoComplete="off" className="w-full rounded-lg border px-3 py-2 text-sm mb-2" style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }} />
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
