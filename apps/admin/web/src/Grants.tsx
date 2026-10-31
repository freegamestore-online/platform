import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CompGrant, type RegisteredUser } from './api.ts';
import { ErrorBox, Loading } from './Overview.tsx';

/** Providers the platform can fund a complimentary grant on. Shared with
 *  Users.tsx, which still owns the registered-user table and its Add-key button. */
export const PROVIDERS = ['anthropic', 'openai', 'google', 'github'] as const;

export const MODELS: Record<string, [string, string][]> = {
  anthropic: [
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
    ['claude-opus-4-8', 'Claude Opus 4.8'],
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
  ],
  openai: [
    ['gpt-4o', 'GPT-4o'],
    ['gpt-4o-mini', 'GPT-4o Mini'],
  ],
  google: [
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
  ],
  github: [
    ['openai/gpt-4.1', 'GPT-4.1'],
    ['openai/gpt-4o', 'GPT-4o'],
  ],
};

/** AI Grants — the standalone home for complimentary access and vault keys
 *  (#14 item 5). Previously a section buried under the Users page, which meant
 *  granting access required scrolling past the whole user table and the grant
 *  form could only take a raw login string.
 *
 *  `note` and `expiresAt` were already accepted by POST /api/comp and already
 *  present on CompGrant — the old form just never sent them and the old table
 *  never showed them, so every grant was silently permanent and unattributed. */
export function Grants({ navigate }: { navigate: (h: string) => void }) {
  const [users, setUsers] = useState<RegisteredUser[] | null>(null);
  const [grants, setGrants] = useState<CompGrant[]>([]);
  const [funded, setFunded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [keyModal, setKeyModal] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    api<{ users: RegisteredUser[] }>('/api/allusers')
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));
    api<{ grants: CompGrant[]; funded: string[] }>('/api/comp')
      .then((d) => {
        setGrants(d.grants ?? []);
        setFunded(d.funded ?? []);
      })
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!users) return [];
    return q
      ? users.filter((u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
      : users;
  }, [users, search]);

  if (error) return <ErrorBox message={error} />;
  if (!users) return <Loading />;

  const grantByUser = new Map(grants.map((g) => [g.userId, g]));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-bold mb-1 text-ink">AI Grants</h1>
        <p className="text-sm mb-3 text-muted">
          Platform-funded builds for select users — a user's own vault key always wins over a grant.{' '}
          {funded.length
            ? `Funded providers: ${funded.join(', ')}.`
            : 'No platform keys are funded yet, so grants cannot resolve.'}
        </p>
        {msg && <p className="text-sm mb-2 font-medium text-accent-deep">{msg}</p>}
        <GrantForm
          users={users}
          funded={funded}
          onSaved={() => {
            reload();
            setMsg('Grant saved.');
          }}
        />
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2 text-ink">
          Active grants <span className="text-sm font-normal text-muted">({grants.length})</span>
        </h2>
        <div className="rounded-xl border overflow-x-auto border-line bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5">Model</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="px-4 py-2.5">Note</th>
                <th className="px-4 py-2.5">Granted by</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {grants.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-muted" colSpan={7}>
                    No grants.
                  </td>
                </tr>
              )}
              {grants.map((g) => (
                <tr key={g.userId} className="border-t border-line">
                  <td className="px-4 py-2.5 text-xs">
                    <button
                      onClick={() => navigate(`/users/${encodeURIComponent(g.userId)}`)}
                      className="text-accent"
                    >
                      {g.userId}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">{g.provider}</td>
                  <td className="px-4 py-2.5 text-xs">{g.model}</td>
                  <td className={`px-4 py-2.5 text-xs ${expiryTone(g.expiresAt)}`}>
                    {expiryLabel(g.expiresAt)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{g.note || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{g.grantedBy || '—'}</td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={async () => {
                        if (!confirm(`Revoke grant for ${g.userId}?`)) return;
                        await api(`/api/comp/${encodeURIComponent(g.userId)}`, {
                          method: 'DELETE',
                        });
                        reload();
                        setMsg('Grant revoked.');
                      }}
                      className="text-xs text-danger"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-bold text-ink">
            Vault keys{' '}
            <span className="text-sm font-normal text-muted">
              ({filtered.length}/{users.length})
            </span>
          </h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="rounded-lg border px-3 py-1.5 text-sm w-56 border-line bg-panel text-ink"
          />
        </div>
        <div className="rounded-xl border overflow-x-auto border-line bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">Keys</th>
                <th className="px-4 py-2.5">Grant</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td className="px-4 py-3 text-muted" colSpan={4}>
                    No matching users.
                  </td>
                </tr>
              )}
              {filtered.map((u) => {
                const g = grantByUser.get(u.id) ?? null;
                return (
                  <tr key={u.id} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => navigate(`/users/${encodeURIComponent(u.id)}`)}
                        className="font-semibold text-left text-accent"
                      >
                        {u.name}
                      </button>
                      <div className="text-[10px] text-muted">{u.id}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.keys.length === 0 ? (
                        <span className="text-xs text-muted">none</span>
                      ) : (
                        u.keys.map((k) => (
                          <span
                            key={k}
                            className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 mr-1 border border-accent text-accent-deep"
                          >
                            {k}
                            <button
                              title="Remove key"
                              onClick={async () => {
                                if (!confirm(`Remove ${k} key for ${u.name}?`)) return;
                                await api('/api/userkey/delete', {
                                  method: 'POST',
                                  body: JSON.stringify({ userId: u.id, provider: k }),
                                });
                                reload();
                                setMsg('Key removed.');
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {g
                        ? `${g.provider}/${g.model}`
                        : u.grant
                          ? `${u.grant.provider}/${u.grant.model}`
                          : '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <button
                        onClick={() => setKeyModal({ id: u.id, name: u.name })}
                        className="text-xs font-semibold rounded-lg px-2.5 py-1 text-white bg-accent"
                      >
                        Paste API key
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {keyModal && (
        <AddKeyModal
          target={keyModal}
          onClose={() => setKeyModal(null)}
          onSaved={() => {
            setKeyModal(null);
            reload();
            setMsg('Key saved — they can build now.');
          }}
        />
      )}
    </div>
  );
}

/** `null` expiry is a PERMANENT grant, which is the riskier state — say so
 *  rather than rendering an innocuous dash. */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return 'never';
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return expiresAt;
  return t < Date.now() ? `${expiresAt.slice(0, 10)} (expired)` : expiresAt.slice(0, 10);
}

function expiryTone(expiresAt: string | null): string {
  if (!expiresAt) return 'text-warning';
  const t = Date.parse(expiresAt);
  if (!Number.isNaN(t) && t < Date.now()) return 'text-danger';
  return 'text-muted';
}

function GrantForm({
  users,
  funded,
  onSaved,
}: {
  users: RegisteredUser[];
  funded: string[];
  onSaved: () => void;
}) {
  const [login, setLogin] = useState('');
  const [provider, setProvider] = useState(funded[0] ?? 'anthropic');
  const [model, setModel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (funded.length && !funded.includes(provider)) setProvider(funded[0]!);
  }, [funded, provider]);
  const models = MODELS[provider] ?? [];

  return (
    <div className="rounded-xl border p-4 border-line bg-panel">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="User">
          {/* A datalist keeps this a free-text field — a grant can be issued to a
              login that has not signed in yet, which a <select> would prevent. */}
          <input
            list="grant-users"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="github-login"
            className="rounded-lg border px-3 py-1.5 text-sm w-48 border-line bg-panel text-ink"
          />
          <datalist id="grant-users">
            {users.map((u) => (
              <option key={u.id} value={u.name}>
                {u.id}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Provider">
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel('');
            }}
            className="rounded-lg border px-2 py-1.5 text-sm border-line bg-panel text-ink"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p} disabled={!funded.includes(p)}>
                {p}
                {funded.includes(p) ? '' : ' (no key)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm border-line bg-panel text-ink"
          >
            <option value="">model…</option>
            {models.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expires (optional)">
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border px-2 py-1.5 text-sm border-line bg-panel text-ink"
          />
        </Field>
        <Field label="Note (optional)">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="why this grant exists"
            className="rounded-lg border px-3 py-1.5 text-sm w-56 border-line bg-panel text-ink"
          />
        </Field>
        <button
          disabled={busy || !login || !model}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api('/api/comp', {
                method: 'POST',
                // Omit the optional fields entirely when blank rather than
                // sending "" — the agent stores what it is given.
                body: JSON.stringify({
                  login,
                  provider,
                  model,
                  ...(expiresAt ? { expiresAt } : {}),
                  ...(note ? { note } : {}),
                }),
              });
              setLogin('');
              setNote('');
              setExpiresAt('');
              onSaved();
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 bg-accent"
        >
          Save Grant
        </button>
      </div>
      {err && <p className="text-sm mt-2 text-danger">{err}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always the form control, so the label wraps it.
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Paste a provider key into a user's encrypted vault. Exported because the
 *  Users page keeps its own Add-key button on the registered-user table. */
export function AddKeyModal({
  target,
  onClose,
  onSaved,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [provider, setProvider] = useState('anthropic');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="rounded-2xl border p-5 w-full max-w-md border-line bg-panel">
        <h3 className="font-bold mb-3 text-ink">Add API key for {target.name}</h3>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="w-full rounded-lg border px-2 py-2 text-sm mb-2 border-line bg-panel text-ink"
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…  (stored encrypted, never shown again)"
          autoComplete="off"
          className="w-full rounded-lg border px-3 py-2 text-sm mb-2 border-line bg-panel text-ink"
        />
        {err && <p className="text-sm mb-2 text-danger">{err}</p>}
        <div className="flex gap-2 mt-2">
          <button
            disabled={busy || !key}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await api('/api/userkey', {
                  method: 'POST',
                  body: JSON.stringify({ userId: target.id, provider, key }),
                });
                onSaved();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50 bg-accent"
          >
            Save key
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm border border-line text-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
