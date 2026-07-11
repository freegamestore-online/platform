import { useEffect, useState } from "react";
import { api, type PlatformStats } from "./api.ts";

export function Loading() {
  return <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>;
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "#fca5a5", background: "#fef2f2", color: "#b91c1c" }}>
      {message}
    </div>
  );
}

export function Overview() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PlatformStats>("/api/stats").then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stats) return <Loading />;

  const max = Math.max(1, ...stats.errorSeries.map((p) => p.c));
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <Stat label="Games" value={stats.games} />
        <Stat label="Creators" value={stats.creators} />
        <Stat label="Errors (24h)" value={stats.errors24h} tone={stats.errors24h > 0 ? "bad" : "good"} />
        <Stat label="Errors (total)" value={stats.errorsTotal} tone={stats.errorsTotal > 0 ? "warn" : undefined} />
      </div>
      <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--muted)" }}>Errors (last 14 days)</h2>
      <div className="flex items-end gap-1.5 h-36 rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        {stats.errorSeries.length === 0 && <p className="text-sm self-center mx-auto" style={{ color: "var(--muted)" }}>No errors logged.</p>}
        {stats.errorSeries.map((p) => (
          <div key={p.d} className="flex-1 flex flex-col items-center justify-end gap-1 h-full" title={`${p.d}: ${p.c}`}>
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>{p.c}</span>
            <div className="w-3/4 rounded-t" style={{ height: `${Math.round((p.c / max) * 90)}%`, minHeight: 2, background: p.c > 0 ? "#f87171" : "var(--line)" }} />
            <span className="text-[9px]" style={{ color: "var(--muted)" }}>{p.d.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "#dc2626" : tone === "warn" ? "#d97706" : tone === "good" ? "#059669" : "var(--ink)";
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}
