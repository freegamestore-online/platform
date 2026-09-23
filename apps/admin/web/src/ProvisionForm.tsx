import { useState } from 'react';
import { api, type ProvisionStep } from './api.ts';

const FIELDS = [
  { name: 'id', ph: 'ID (e.g. chess)', req: true },
  { name: 'name', ph: 'Display name (e.g. Chess)', req: true },
  { name: 'category', ph: 'Category (e.g. strategy)', req: true },
  { name: 'icon', ph: 'Icon HTML entity (e.g. &#9812;)', req: true },
  { name: 'iconBg', ph: 'Icon bg color', req: false, def: '#ecfdf5' },
  { name: 'description', ph: 'Short description', req: true },
  { name: 'creatorGithub', ph: 'Creator GitHub username (gets push access)', req: false },
] as const;

export function ProvisionForm() {
  const [values, setValues] = useState<Record<string, string>>({ iconBg: '#ecfdf5' });
  const [steps, setSteps] = useState<ProvisionStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    setSteps(null);
    try {
      const res = await api<{ steps: ProvisionStep[]; success: boolean }>('/api/provision', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSteps(res.steps);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>
        Provision a game
      </h1>
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Admin escape hatch — creators normally self-serve from the console. Idempotent:
        re-provisioning an existing id skips.
      </p>
      <div className="flex flex-col gap-2">
        {FIELDS.map((f) => (
          <input
            key={f.name}
            value={values[f.name] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.ph + (f.req ? ' *' : '')}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}
          />
        ))}
        <button
          disabled={busy || FIELDS.some((f) => f.req && !values[f.name]?.trim())}
          onClick={submit}
          className="rounded-xl py-2.5 font-semibold text-white disabled:opacity-50 mt-1"
          style={{ background: 'var(--accent)' }}
        >
          {busy ? 'Provisioning…' : 'Provision'}
        </button>
      </div>
      {err && (
        <p className="text-sm mt-3" style={{ color: '#dc2626' }}>
          {err}
        </p>
      )}
      {steps && (
        <div
          className="mt-4 rounded-xl border p-4 flex flex-col gap-1.5"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          {steps.map((s) => (
            <div key={s.name} className="text-sm">
              <span
                className="font-bold mr-2"
                style={{
                  color:
                    s.status === 'ok' ? '#059669' : s.status === 'skip' ? '#d97706' : '#dc2626',
                }}
              >
                {s.status.toUpperCase()}
              </span>
              <span style={{ color: 'var(--ink)' }}>{s.name}</span>
              <span className="text-xs ml-2" style={{ color: 'var(--muted)' }}>
                {s.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
