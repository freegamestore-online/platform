import { useEffect, useRef, useState } from "react";
import { api, timeAgo, type ErrorRow } from "./api.ts";
import { ErrorBox, Loading } from "./Overview.tsx";

const KNOWN_SOURCES = ["api/create", "console/web", "admin", "admin/provision", "admin/reconcile", "admin/games.patch", "admin/games.delete"];

export function ErrorCard({ e }: { e: ErrorRow }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
      <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5" style={{ color: "var(--muted)" }}>
        <span className="rounded px-1.5 py-0.5 border" style={{ borderColor: "var(--line)" }}>{e.source}</span>
        <span>{timeAgo(e.ts)}</span>
        {e.user_github && <span>@{e.user_github}</span>}
        {e.context && <span className="truncate max-w-xs">{e.context}</span>}
      </div>
      <div className="text-sm font-semibold" style={{ color: "#dc2626" }}>{e.message}</div>
      {e.stack && <pre className="text-xs mt-2 p-2 rounded overflow-auto max-h-36 whitespace-pre-wrap" style={{ background: "var(--accent-soft)", color: "var(--muted)" }}>{e.stack}</pre>}
    </div>
  );
}

export function ErrorsPage() {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  // Track the applied filters separately so we only refetch on submit/select.
  const [appliedUser, setAppliedUser] = useState("");
  const [appliedSource, setAppliedSource] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    const params = new URLSearchParams({ limit: "200" });
    if (appliedUser) params.set("user", appliedUser);
    if (appliedSource) params.set("source", appliedSource);
    api<ErrorRow[]>(`/api/errors?${params}`).then(setRows).catch((e) => setError(e.message));
  }, [appliedUser, appliedSource]);

  const applyUser = () => setAppliedUser(userFilter.trim());
  const clearFilters = () => {
    setUserFilter("");
    setSourceFilter("");
    setAppliedUser("");
    setAppliedSource("");
  };
  const hasFilter = appliedUser || appliedSource;

  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--ink)" }}>Errors &amp; crashes</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>Persisted from all platform sources. Newest first.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          ref={inputRef}
          type="text"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyUser()}
          placeholder="Filter by GitHub login…"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)", minWidth: 200 }}
        />
        <button
          onClick={applyUser}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >Apply</button>
        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setAppliedSource(e.target.value); }}
          className="rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--panel)", color: "var(--ink)" }}
        >
          <option value="">All sources</option>
          {KNOWN_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {hasFilter && (
          <button
            onClick={clearFilters}
            className="rounded-lg px-3 py-1.5 text-sm border"
            style={{ borderColor: "var(--line)", color: "var(--muted)" }}
          >Clear</button>
        )}
      </div>

      {!rows ? <Loading /> : rows.length === 0 ? (
        <p className="text-sm font-medium" style={{ color: "#059669" }}>
          {hasFilter ? "No errors match the current filter." : "No errors logged — clean."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((e, i) => <ErrorCard key={i} e={e} />)}
        </div>
      )}
    </div>
  );
}
