import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { api, timeAgo, type ErrorRow, type GameInfo, type QualityData, type RegisteredUser, type SessionRow } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

interface OpsData {
  sessions: SessionRow[];
  users: RegisteredUser[];
  games: GameInfo[];
  quality: QualityData["games"];
  errors: ErrorRow[];
}

const ACTIVE_PHASES = new Set(["writing", "provisioning", "pushing", "building"]);
const STUCK_MS = 20 * 60 * 1000;

export function Ops({ navigate }: { navigate: (h: string) => void }) {
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ sessions: SessionRow[] }>("/api/sessions"),
      api<{ users: RegisteredUser[] }>("/api/allusers"),
      api<GameInfo[]>("/api/status"),
      api<QualityData>("/api/quality").catch(() => ({ timestamp: "", games: [] })),
      api<ErrorRow[]>("/api/errors?limit=50"),
    ])
      .then(([sessions, users, games, quality, errors]) => {
        setData({
          sessions: sessions.sessions ?? [],
          users: users.users ?? [],
          games: games ?? [],
          quality: quality.games ?? [],
          errors: errors ?? [],
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const qualityById = new Map(data.quality.map((g) => [g.id, g]));
    const gameIds = new Set(data.games.map((g) => g.id));
    const busy = data.sessions.filter((s) => ACTIVE_PHASES.has(s.activity?.phase ?? ""));
    const stuck = busy.filter((s) => now - tsMs(s.activity?.updatedAt || s.updatedAt) > STUCK_MS);
    const failed = data.sessions.filter((s) => s.activity?.phase === "error");
    const drafts = data.sessions.filter((s) => s.gameId && !s.deployed && s.activity?.phase !== "error");
    const missingLiveGame = data.sessions.filter((s) => s.gameId && s.deployed && !gameIds.has(s.gameId));
    const allWeakQuality = data.games
      .map((g) => ({ game: g, q: qualityById.get(g.id) }))
      .filter(({ q }) => q && (q.score < 80 || q.consoleErrors.length > 0))
      .sort((a, b) => (a.q?.score ?? 100) - (b.q?.score ?? 100));
    const allUsersNeedingKeys = data.users
      .filter((u) => u.keys.length === 0 && !u.grant)
      .sort((a, b) => tsMs(b.lastSeen) - tsMs(a.lastSeen));

    return {
      busy,
      stuck,
      failed,
      drafts,
      missingLiveGame,
      weakQuality: allWeakQuality.slice(0, 8),
      weakQualityCount: allWeakQuality.length,
      usersNeedingKeys: allUsersNeedingKeys.slice(0, 8),
      usersNeedingKeysCount: allUsersNeedingKeys.length,
    };
  }, [data]);

  if (error) return <ErrorBox message={error} />;
  if (!data || !model) return <Loading />;

  const attention = model.stuck.length + model.failed.length + model.missingLiveGame.length + model.usersNeedingKeysCount + model.weakQualityCount;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Operations</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Agent work, creator support, and game health in one queue.</p>
        </div>
        <div className="text-xs" style={{ color: "var(--muted)" }}>Last loaded {new Date().toLocaleTimeString()}</div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Needs attention" value={attention} tone={attention > 0 ? "bad" : "good"} />
        <Stat label="Busy agents" value={model.busy.length} tone={model.busy.length > 0 ? "warn" : undefined} />
        <Stat label="Stuck agents" value={model.stuck.length} tone={model.stuck.length > 0 ? "bad" : "good"} />
        <Stat label="Failed sessions" value={model.failed.length} tone={model.failed.length > 0 ? "bad" : "good"} />
        <Stat label="Users no key" value={model.usersNeedingKeysCount} tone={model.usersNeedingKeysCount > 0 ? "warn" : "good"} />
      </div>

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4">
        <Panel title="Agent Queue">
          <SessionTable
            rows={[...model.stuck, ...model.failed, ...model.busy.filter((s) => !model.stuck.includes(s) && !model.failed.includes(s)), ...model.drafts].slice(0, 14)}
            empty="No active or failed agent work."
            navigate={navigate}
          />
        </Panel>

        <Panel title="Support Risks">
          <div className="space-y-3">
            {model.usersNeedingKeys.map((u) => (
              <button key={u.id} onClick={() => navigate(`/users/${encodeURIComponent(u.id)}`)} className="block w-full text-left rounded-lg border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm" style={{ color: "var(--ink)" }}>{u.name}</span>
                  <span className="text-xs" style={{ color: "var(--warning)" }}>no key/grant</span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>Last seen {timeAgo(u.lastSeen || u.createdAt || undefined)}</div>
              </button>
            ))}
            {model.usersNeedingKeys.length === 0 && <Empty text="No keyless active users in the first 500 users." />}
          </div>
        </Panel>

        <Panel title="Game Quality">
          <div className="space-y-2">
            {model.weakQuality.map(({ game, q }) => (
              <a key={game.id} href={`https://${game.domain}`} target="_blank" rel="noopener" className="block rounded-lg border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm" style={{ color: "var(--ink)" }}>{game.name}</span>
                  <span className="text-xs font-bold" style={{ color: q && q.score >= 80 ? "var(--warning)" : "var(--error)" }}>{q?.score ?? "-"}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{q?.loadTimeMs ?? "-"}ms load, {q?.consoleErrors.length ?? 0} console errors</div>
              </a>
            ))}
            {model.weakQuality.length === 0 && <Empty text="No low-quality games in the latest audit." />}
          </div>
        </Panel>

        <Panel title="Recent Platform Errors">
          <div className="space-y-2">
            {data.errors.slice(0, 8).map((e, i) => (
              <div key={`${e.ts}-${i}`} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: "var(--error)" }}>{e.source}</span>
                  <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--muted)" }}>{timeAgo(e.ts)}</span>
                </div>
                <div className="text-xs mt-1 line-clamp-2" style={{ color: "var(--ink)" }}>{e.message}</div>
              </div>
            ))}
            {data.errors.length === 0 && <Empty text="No recent platform errors." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SessionTable({ rows, empty, navigate }: { rows: SessionRow[]; empty: string; navigate: (h: string) => void }) {
  if (rows.length === 0) return <Empty text={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase" style={{ color: "var(--muted)" }}>
            <th className="py-2 pr-3">State</th>
            <th className="py-2 pr-3">Session</th>
            <th className="py-2 pr-3">Game</th>
            <th className="py-2 pr-3">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} onClick={() => navigate(`/sessions/${s.id}`)} className="border-t cursor-pointer hover:opacity-80" style={{ borderColor: "var(--line)" }}>
              <td className="py-2 pr-3"><ActivityBadge session={s} /></td>
              <td className="py-2 pr-3">
                <div className="font-semibold" style={{ color: "var(--ink)" }}>{s.name}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>{s.user}</div>
              </td>
              <td className="py-2 pr-3">{s.gameId || <span style={{ color: "var(--muted)" }}>-</span>}</td>
              <td className="py-2 pr-3 text-xs whitespace-nowrap" style={{ color: "var(--muted)" }}>{timeAgo(s.activity?.updatedAt || s.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityBadge({ session }: { session: SessionRow }) {
  const phase = session.activity?.phase ?? (session.deployed ? "live" : "idle");
  const age = Date.now() - tsMs(session.activity?.updatedAt || session.updatedAt);
  const stuck = ACTIVE_PHASES.has(phase) && age > STUCK_MS;
  const color = phase === "error" || stuck ? "var(--error)" : phase === "live" ? "var(--success)" : ACTIVE_PHASES.has(phase) ? "var(--warning)" : "var(--muted)";
  const label = stuck ? "stuck" : phase;
  const title = [session.activity?.detail, session.activity?.updatedAt ? `updated ${session.activity.updatedAt}` : ""].filter(Boolean).join(" - ");
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold" title={title} style={{ borderColor: color, color }}>
      {label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <h2 className="text-sm font-bold mb-3" style={{ color: "var(--ink)" }}>{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "var(--error)" : tone === "warn" ? "var(--warning)" : tone === "good" ? "var(--success)" : "var(--ink)";
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm" style={{ color: "var(--muted)" }}>{text}</p>;
}

function tsMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const s = String(ts);
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}
