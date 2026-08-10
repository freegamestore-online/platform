import { useEffect, useMemo, useState } from "react";
import { api, type GameInfo, type QualityData } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

export function GamesList() {
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [quality, setQuality] = useState<Map<string, QualityData["games"][number]>>(new Map());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<GameInfo[]>("/api/status").then(setGames).catch((e) => setError(e.message));
    api<QualityData>("/api/quality")
      .then((q) => setQuality(new Map((q?.games ?? []).map((g) => [g.id, g]))))
      .catch(() => {}); // 204/no data is fine
  }, []);

  const filtered = useMemo(() => {
    if (!games) return [];
    const q = search.toLowerCase();
    return q ? games.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q)) : games;
  }, [games, search]);

  if (error) return <ErrorBox message={error} />;
  if (!games) return <Loading />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Games <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>({games.length})</span></h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="rounded-lg border px-3 py-1.5 text-sm w-48"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}
        />
      </div>
      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              <th className="px-4 py-2.5">Game</th><th className="px-4 py-2.5">Quality</th><th className="px-4 py-2.5">Load</th><th className="px-4 py-2.5">Live</th><th className="px-4 py-2.5">Repo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const q = quality.get(g.id);
              const qColor = !q ? "var(--muted)" : q.score >= 95 ? "#059669" : q.score >= 80 ? "#d97706" : "#dc2626";
              return (
                <tr key={g.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-2.5"><span className="font-semibold" style={{ color: "var(--ink)" }}>{g.name}</span> <span className="text-xs" style={{ color: "var(--muted)" }}>{g.id}</span></td>
                  <td className="px-4 py-2.5 font-bold" style={{ color: qColor }}>{q ? q.score : "—"}</td>
                  <td className="px-4 py-2.5" style={{ color: "var(--muted)" }}>{q ? `${q.loadTimeMs}ms` : "—"}</td>
                  <td className="px-4 py-2.5"><a href={`https://${g.domain}`} target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>{g.domain}</a></td>
                  <td className="px-4 py-2.5"><a href={`https://github.com/${g.org}/${g.id}`} target="_blank" rel="noopener" className="text-xs" style={{ color: "var(--muted)" }}>{g.org}/{g.id}</a></td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td className="px-4 py-3" colSpan={5} style={{ color: "var(--muted)" }}>No results</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
