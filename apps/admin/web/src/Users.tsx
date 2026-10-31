import { useCallback, useEffect, useState } from 'react';
import { api, type Creator, type RegisteredUser } from './api.ts';
// Grants + vault-key UI moved to the standalone Grants page (#14 item 5). The
// modal is shared rather than duplicated so the two pages cannot drift.
import { AddKeyModal } from './Grants.tsx';
import { ErrorBox, Loading } from './Overview.tsx';

export function UsersPage({ navigate }: { navigate: (h: string) => void }) {
  const [users, setUsers] = useState<RegisteredUser[] | null>(null);
  const [creators, setCreators] = useState<Creator[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [keyModal, setKeyModal] = useState<{ id: string; name: string } | null>(null);

  const reload = useCallback(() => {
    api<{ users: RegisteredUser[] }>('/api/allusers')
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));
    api<Creator[]>('/api/users')
      .then(setCreators)
      .catch(() => {});
  }, []);
  useEffect(reload, [reload]);

  if (error) return <ErrorBox message={error} />;
  if (!users) return <Loading />;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="text-xl font-bold mb-1 text-ink">
          Registered users <span className="text-sm font-normal text-muted">({users.length})</span>
        </h1>
        <p className="text-sm mb-3 text-muted">
          Click <strong>Add key</strong> to paste a provider API key into a user's encrypted vault —
          their studio picks it up automatically.
        </p>
        {msg && <p className="text-sm mb-2 font-medium text-accent-deep">{msg}</p>}
        <div className="rounded-xl border border-line bg-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-4 py-2.5">User</th>
                <th className="px-4 py-2.5">ID</th>
                <th className="px-4 py-2.5">Keys</th>
                <th className="px-4 py-2.5">Grant</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    <button
                      onClick={() => navigate(`/users/${encodeURIComponent(u.id)}`)}
                      className="font-semibold text-left text-accent"
                    >
                      {u.name}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{u.id}</td>
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
                            }}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {u.grant ? `${u.grant.provider}/${u.grant.model}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <button
                      onClick={() => navigate(`/users/${encodeURIComponent(u.id)}`)}
                      className="text-xs font-semibold rounded-lg px-2.5 py-1 mr-2 border border-line text-accent"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => setKeyModal({ id: u.id, name: u.name })}
                      className="text-xs font-semibold rounded-lg px-2.5 py-1 text-white bg-accent"
                    >
                      Add key
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-sm text-muted">
        Complimentary AI grants moved to the{' '}
        <button onClick={() => navigate('/grants')} className="font-semibold text-accent">
          Grants
        </button>{' '}
        page.
      </p>

      <section>
        <h2 className="text-lg font-bold mb-2 text-ink">Creators</h2>
        <div className="rounded-xl border border-line bg-panel overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted">
                <th className="px-4 py-2.5">GitHub</th>
                <th className="px-4 py-2.5">Games</th>
                <th className="px-4 py-2.5">IDs</th>
              </tr>
            </thead>
            <tbody>
              {(creators ?? []).map((c) => (
                <tr key={c.login} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => navigate(`/users/${encodeURIComponent(c.login)}`)}
                      className="font-semibold mr-2 text-accent"
                    >
                      {c.login}
                    </button>
                    {c.login !== '(unknown)' && (
                      <a
                        href={`https://github.com/${c.login}`}
                        target="_blank"
                        rel="noopener"
                        className="text-xs text-muted"
                      >
                        GitHub
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-ink">{c.games.length}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{c.games.join(', ')}</td>
                </tr>
              ))}
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
